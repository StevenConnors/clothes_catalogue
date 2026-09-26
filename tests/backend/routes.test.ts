import type { WardrobeDocument } from "@/lib/contracts/persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, repoMock, storeMock, pageMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  repoMock: { getActiveById: vi.fn(), listActive: vi.fn(), countActiveByType: vi.fn(), updateType: vi.fn(), softDelete: vi.fn() },
  storeMock: { readPrivate: vi.fn() },
  pageMock: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/data/wardrobe-repository", () => ({
  getWardrobeRepository: () => repoMock,
  listActiveItemsPage: pageMock,
  toItemDTO: (x: WardrobeDocument) => ({ id: x._id, type: x.type, images: { cutout: `/api/items/${x._id}/image?variant=cutout`, original: `/api/items/${x._id}/image?variant=original` }, createdAt: x.createdAt.toISOString(), updatedAt: x.updatedAt.toISOString() }),
}));
vi.mock("@/lib/storage/blob", () => ({ getImageStore: () => storeMock }));

import { GET as listItems } from "@/app/api/items/route";
import { GET as getImage } from "@/app/api/items/[id]/image/route";
import { encodeItemCursor } from "@/lib/data/item-cursor";

const validId = "a2912d73-45dc-4214-a61a-b2b3318ace1f";
beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret";
  process.env.AUTH_ALLOWED_GITHUB_ID = "123456";
});

describe("catalogue route authorization", () => {
  it("returns 401 for an anonymous catalogue request", async () => {
    authMock.mockResolvedValue(null);
    const response = await listItems(new Request("https://wardrobe.test/api/items"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    expect(repoMock.listActive).not.toHaveBeenCalled();
    expect(pageMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a signed-in non-owner", async () => {
    authMock.mockResolvedValue({ user: { id: "different-github-id" } });
    const response = await listItems(new Request("https://wardrobe.test/api/items"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(repoMock.listActive).not.toHaveBeenCalled();
    expect(pageMock).not.toHaveBeenCalled();
  });

  it("hides image bytes for a removed or missing item", async () => {
    authMock.mockResolvedValue({ user: { id: "123456" } });
    repoMock.getActiveById.mockResolvedValue(null);
    const response = await getImage(
      new Request(`https://wardrobe.test/api/items/${validId}/image?variant=cutout`),
      { params: Promise.resolve({ id: validId }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(storeMock.readPrivate).not.toHaveBeenCalled();
  });
});

import { GET as getItem, PATCH, DELETE } from "@/app/api/items/[id]/route";
import { BlobServiceNotAvailable } from "@vercel/blob";
import sharp from "sharp";

const activeDoc = () => ({
  _id: validId, type: "shirt", sourceSha256: "a".repeat(64),
  images: { original: { pathname: "orig", contentType: "image/jpeg" }, cutout: { pathname: "cut", contentType: "image/png" } },
  createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z"), deletedAt: null,
});
const ctx = { params: Promise.resolve({ id: validId }) };
const ownerRequest = (url: string, init: RequestInit = {}) => new Request(url, {
  ...init,
  headers: { origin: "https://wardrobe.test", ...(init.headers as Record<string, string> | undefined) },
});

describe("catalogue validation and mutations", () => {
  beforeEach(() => authMock.mockResolvedValue({ user: { id: "123456" } }));

  it("serves a small transparent thumbnail, reuses it, and still checks access on every request", async () => {
    const png = await sharp({ create: { width: 1600, height: 1600, channels: 4, background: { r: 30, g: 80, b: 40, alpha: 0.5 } } }).png().toBuffer();
    repoMock.getActiveById.mockResolvedValue({ ...activeDoc(), images: { ...activeDoc().images, cutout: { pathname: "thumbnail-fixture", contentType: "image/png" } } });
    storeMock.readPrivate.mockImplementation(async () => ({ body: new ReadableStream({ start(controller) { controller.enqueue(png); controller.close(); } }), contentType: "image/png" }));
    const request = () => new Request(`https://wardrobe.test/api/items/${validId}/image?variant=cutout&size=thumbnail`);
    const response = await getImage(request(), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const output = Buffer.from(await response.arrayBuffer());
    expect(await sharp(output).metadata()).toMatchObject({ width: 640, height: 640, hasAlpha: true });
    expect(output.length).toBeLessThan(png.length);
    expect((await getImage(request(), ctx)).status).toBe(200);
    expect(storeMock.readPrivate).toHaveBeenCalledTimes(1);
    authMock.mockResolvedValue(null);
    expect((await getImage(request(), ctx)).status).toBe(401);
    authMock.mockResolvedValue({ user: { id: "other" } });
    expect((await getImage(request(), ctx)).status).toBe(403);
    authMock.mockResolvedValue({ user: { id: "123456" } });
    repoMock.getActiveById.mockResolvedValue(null);
    expect((await getImage(request(), ctx)).status).toBe(404);
    expect(storeMock.readPrivate).toHaveBeenCalledTimes(1);
  });

  it.each(["variant=cutout&size=huge", "variant=original&size=thumbnail"])("rejects unsupported thumbnail requests: %s", async (query) => {
    expect((await getImage(new Request(`https://wardrobe.test/api/items/${validId}/image?${query}`), ctx)).status).toBe(400);
    expect(storeMock.readPrivate).not.toHaveBeenCalled();
  });

  it("rejects malformed IDs and strict PATCH bodies", async () => {
    const malformed = await getItem(ownerRequest("https://wardrobe.test/api/items/nope"), { params: Promise.resolve({ id: "nope" }) });
    expect(malformed.status).toBe(400);
    const invalidType = await PATCH(ownerRequest(`https://wardrobe.test/api/items/${validId}`, { method: "PATCH", body: JSON.stringify({ type: "dress" }) }), ctx);
    expect(invalidType.status).toBe(400);
    const extraField = await PATCH(ownerRequest(`https://wardrobe.test/api/items/${validId}`, { method: "PATCH", body: JSON.stringify({ type: "shirt", note: "x" }) }), ctx);
    expect(extraField.status).toBe(400);
    expect(repoMock.updateType).not.toHaveBeenCalled();
  });

  it.each([undefined, "https://evil.test"]) ("rejects missing or cross-origin mutation Origin: %s", async (origin) => {
    const headers: HeadersInit = origin ? { origin } : {};
    const response = await PATCH(new Request(`https://wardrobe.test/api/items/${validId}`, {
      method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ type: "pants" }),
    }), ctx);
    expect(response.status).toBe(403);
    expect(repoMock.updateType).not.toHaveBeenCalled();
  });

  it("returns counts across all active types and filtered matching total", async () => {
    repoMock.listActive.mockResolvedValue([activeDoc()]);
    repoMock.countActiveByType.mockResolvedValue({ outer: 2, shirt: 1, tshirt: 0, pants: 1, shorts: 0, shoes: 0 });
    const response = await listItems(new Request("https://wardrobe.test/api/items?type=shirt"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, counts: { outer: 2, shirt: 1, pants: 1 } });
    expect(repoMock.listActive).toHaveBeenCalledWith("shirt");
  });

  it("returns a bounded page with a cursor and the full matching total", async () => {
    const cursor = encodeItemCursor({ version: 1, filter: "shirt", type: "shirt", createdAt: activeDoc().createdAt.toISOString(), id: validId });
    pageMock.mockResolvedValue({ documents: [activeDoc()], nextCursor: cursor });
    repoMock.countActiveByType.mockResolvedValue({ outer: 2, shirt: 8, tshirt: 0, pants: 1, shorts: 0, shoes: 0 });
    const response = await listItems(new Request("https://wardrobe.test/api/items?type=shirt&limit=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ total: 8, nextCursor: cursor, items: [{ id: validId }] });
    expect(pageMock).toHaveBeenCalledWith({ type: "shirt", limit: 1 });
    expect(repoMock.listActive).not.toHaveBeenCalled();
    const next = await listItems(new Request(`https://wardrobe.test/api/items?type=shirt&cursor=${cursor}`));
    expect(next.status).toBe(200);
    expect(pageMock).toHaveBeenLastCalledWith({ type: "shirt", limit: 24, cursor });
  });

  it("reports all-category totals independently of the returned page size", async () => {
    pageMock.mockResolvedValue({ documents: [activeDoc()], nextCursor: null });
    repoMock.countActiveByType.mockResolvedValue({ outer: 2, shirt: 8, tshirt: 0, pants: 1, shorts: 0, shoes: 0 });
    const response = await listItems(new Request("https://wardrobe.test/api/items?limit=24"));
    expect(await response.json()).toMatchObject({ total: 11, nextCursor: null });
  });

  it.each(["limit=0", "limit=49", "limit=1.5", "limit=nope", "cursor=", "cursor=invalid", "type=dress&limit=24"])("rejects invalid pagination before reading items: %s", async query => {
    const response = await listItems(new Request(`https://wardrobe.test/api/items?${query}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(pageMock).not.toHaveBeenCalled();
  });

  it.each([null, { user: { id: "other" } }])("protects later pages with the same owner authorization", async session => {
    authMock.mockResolvedValue(session);
    const response = await listItems(new Request("https://wardrobe.test/api/items?limit=24&cursor=invalid"));
    expect(response.status).toBe(session ? 403 : 401);
    expect(pageMock).not.toHaveBeenCalled();
  });

  it("persists a valid type change and repeated soft-delete requests", async () => {
    repoMock.updateType.mockResolvedValue({ ...activeDoc(), type: "pants", updatedAt: new Date("2026-02-01T00:00:00.000Z") });
    const patched = await PATCH(ownerRequest(`https://wardrobe.test/api/items/${validId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "pants" }),
    }), ctx);
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ item: { id: validId, type: "pants" } });
    expect(repoMock.updateType).toHaveBeenCalledWith(validId, "pants");

    repoMock.softDelete.mockResolvedValue(true);
    const firstDelete = await DELETE(ownerRequest(`https://wardrobe.test/api/items/${validId}`, { method: "DELETE" }), ctx);
    const secondDelete = await DELETE(ownerRequest(`https://wardrobe.test/api/items/${validId}`, { method: "DELETE" }), ctx);
    expect(firstDelete.status).toBe(204);
    expect(secondDelete.status).toBe(204);
    expect(repoMock.softDelete).toHaveBeenCalledTimes(2);
  });

  it("returns 404 for a missing private Blob and 503 when Blob is unavailable", async () => {
    authMock.mockResolvedValue({ user: { id: "123456" } });
    repoMock.getActiveById.mockResolvedValue(activeDoc());
    storeMock.readPrivate.mockResolvedValueOnce(null);
    let response = await getImage(new Request(`https://wardrobe.test/api/items/${validId}/image?variant=cutout`), ctx);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    storeMock.readPrivate.mockRejectedValueOnce(new BlobServiceNotAvailable());
    response = await getImage(new Request(`https://wardrobe.test/api/items/${validId}/image?variant=cutout`), ctx);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "SERVICE_UNAVAILABLE" } });
  });

  it("maps service failures to 503 and unexpected failures to 500", async () => {
    repoMock.listActive.mockRejectedValueOnce(Object.assign(new Error("offline"), { name: "MongoServerSelectionError" }));
    let response = await listItems(new Request("https://wardrobe.test/api/items"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "SERVICE_UNAVAILABLE" } });
    repoMock.listActive.mockRejectedValueOnce(new Error("programming bug"));
    response = await listItems(new Request("https://wardrobe.test/api/items"));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });
});
