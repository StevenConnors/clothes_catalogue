import { beforeEach, expect, it, vi } from "vitest";
const { auth, read, delivery } = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), delivery: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/data/wardrobe-repository", () => ({ getActiveItemsByIds: read }));
vi.mock("@/lib/storage/delivery", () => ({ toDeliveryItems: delivery }));
import { GET } from "@/app/api/items/image-urls/route";
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { vi.clearAllMocks(); process.env.AUTH_SECRET = "test"; process.env.AUTH_ALLOWED_GITHUB_ID = "owner"; auth.mockResolvedValue({ user: { id: "owner" } }); });
it.each([null, { user: { id: "other" } }])("checks owner access before refreshing URLs", async session => {
  auth.mockResolvedValue(session);
  expect((await GET(new Request(`https://wardrobe.test/api/items/image-urls?ids=${id}`))).status).toBe(session ? 403 : 401);
  expect(read).not.toHaveBeenCalled(); expect(delivery).not.toHaveBeenCalled();
});
it.each(["invalid", "", Array(49).fill(id).join(",")])("rejects malformed or oversized refresh batches", async ids => {
  expect((await GET(new Request(`https://wardrobe.test/api/items/image-urls?ids=${ids}`))).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});
it("deduplicates IDs, signs only active query results, and disables response caching", async () => {
  const documents = [{ id: "active" }]; read.mockResolvedValue(documents);
  delivery.mockResolvedValue([{ id, images: { cutout: `https://store.private.blob.vercel-storage.com/cutout?token=x`, original: `https://store.private.blob.vercel-storage.com/original?token=x`, thumbnails: [], expiresAt: Date.now() + 120_000 } }]);
  const response = await GET(new Request(`https://wardrobe.test/api/items/image-urls?ids=${id},${id}`));
  expect(response.status).toBe(200); expect(read).toHaveBeenCalledWith([id]); expect(delivery).toHaveBeenCalledWith(documents);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).items).toHaveLength(1);
});
it("omits deleted or missing items from refresh responses", async () => {
  read.mockResolvedValue([]); delivery.mockResolvedValue([]);
  expect(await (await GET(new Request(`https://wardrobe.test/api/items/image-urls?ids=${id}`))).json()).toEqual({ items: [] });
});
