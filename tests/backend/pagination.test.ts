import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Filter } from "mongodb";
import type { WardrobeDocument } from "@/lib/contracts/persistence";
import { CLOTHING_TYPES, type ClothingType } from "@/lib/contracts/wardrobe";

const { collectionMock } = vi.hoisted(() => ({ collectionMock: { find: vi.fn() } }));
vi.mock("@/lib/data/mongodb", () => ({ getDatabase: async () => ({ collection: () => collectionMock }) }));
import { listActiveItemsPage } from "@/lib/data/wardrobe-repository";
import { decodeItemCursor, InvalidItemCursorError } from "@/lib/data/item-cursor";

const document = (index: number, type: ClothingType, date = "2026-01-01T00:00:00.000Z"): WardrobeDocument => ({
  _id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  sourceSha256: String(index).padStart(64, "0"), type,
  createdAt: new Date(date), updatedAt: new Date(date), deletedAt: null,
  images: { original: { pathname: "original", contentType: "image/jpeg" }, cutout: { pathname: "cutout", contentType: "image/png" } },
});

function useRows(rows: WardrobeDocument[]) {
  collectionMock.find.mockImplementation((filter: Filter<WardrobeDocument>) => {
    let limit = Infinity;
    const query = {
      sort: vi.fn(() => query),
      limit: vi.fn((value: number) => { limit = value; return query; }),
      toArray: async () => rows.filter(row => {
        if (row.deletedAt || row.type !== filter.type) return false;
        if (!filter.$or) return true;
        return filter.$or.some(condition => {
          if (condition.createdAt instanceof Date) {
            return row.createdAt.getTime() === condition.createdAt.getTime() && row._id < (condition._id as { $lt: string }).$lt;
          }
          return row.createdAt < (condition.createdAt as { $lt: Date }).$lt;
        });
      }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b._id.localeCompare(a._id)).slice(0, limit),
    };
    return query;
  });
}

beforeEach(() => vi.clearAllMocks());

describe("wardrobe cursor pagination", () => {
  it("pages across category boundaries with equal timestamps and no omissions or duplicates", async () => {
    const removed = { ...document(9, "outer"), deletedAt: new Date() };
    const rows = [document(1, "shoes"), document(2, "shirt"), document(3, "outer"), document(4, "outer"), document(5, "shirt", "2025-12-01T00:00:00.000Z"), removed];
    useRows(rows);
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listActiveItemsPage({ limit: 2, cursor });
      ids.push(...page.documents.map(row => row._id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual([4, 3, 2, 5, 1].map(index => document(index, "shirt")._id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("restricts every page to the selected filter and rejects reusing its cursor for another filter", async () => {
    useRows([document(1, "shirt"), document(2, "shirt"), document(3, "shoes")]);
    const first = await listActiveItemsPage({ type: "shirt", limit: 1 });
    expect(first.documents.map(row => row._id)).toEqual([document(2, "shirt")._id]);
    expect(decodeItemCursor(first.nextCursor!, "shirt")).toMatchObject({ filter: "shirt", type: "shirt" });
    const last = await listActiveItemsPage({ type: "shirt", limit: 1, cursor: first.nextCursor! });
    expect(last.documents.map(row => row._id)).toEqual([document(1, "shirt")._id]);
    expect(last.nextCursor).toBeNull();
    expect(() => decodeItemCursor(first.nextCursor!, "shoes")).toThrow(InvalidItemCursorError);
    expect(() => decodeItemCursor(first.nextCursor!)).toThrow(InvalidItemCursorError);
  });

  it("handles an empty wardrobe and exact page boundaries without an extra cursor", async () => {
    useRows([]);
    expect(await listActiveItemsPage({ limit: 24 })).toEqual({ documents: [], nextCursor: null });
    useRows(CLOTHING_TYPES.map((type, index) => document(index, type)));
    const page = await listActiveItemsPage({ limit: 6 });
    expect(page.documents.map(row => row.type)).toEqual([...CLOTHING_TYPES]);
    expect(page.nextCursor).toBeNull();
  });

  it.each(["", "not-a-cursor", "a".repeat(1025), Buffer.from(JSON.stringify({ version: 99 })).toString("base64url")])("rejects malformed cursors: %s", cursor => {
    expect(() => decodeItemCursor(cursor)).toThrow(InvalidItemCursorError);
  });
});
