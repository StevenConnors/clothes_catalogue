import type { WardrobeDocument } from "@/lib/contracts/persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, repoMock, storeMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  repoMock: { getActiveById: vi.fn(), listActive: vi.fn(), countActiveByType: vi.fn(), updateType: vi.fn(), softDelete: vi.fn() },
  storeMock: { readPrivate: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/data/wardrobe-repository", () => ({
  getWardrobeRepository: () => repoMock,
  toItemDTO: (x: WardrobeDocument) => ({ id: x._id, type: x.type, images: { cutout: `/api/items/${x._id}/image?variant=cutout`, original: `/api/items/${x._id}/image?variant=original` }, createdAt: x.createdAt.toISOString(), updatedAt: x.updatedAt.toISOString() }),
}));
vi.mock("@/lib/storage/blob", () => ({ getImageStore: () => storeMock }));

import { GET as listItems } from "@/app/api/items/route";
import { GET as getImage } from "@/app/api/items/[id]/image/route";

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
  });

  it("returns 403 for a signed-in non-owner", async () => {
    authMock.mockResolvedValue({ user: { id: "different-github-id" } });
    const response = await listItems(new Request("https://wardrobe.test/api/items"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(repoMock.listActive).not.toHaveBeenCalled();
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
