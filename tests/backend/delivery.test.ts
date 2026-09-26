import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WardrobeDocument } from "@/lib/contracts/persistence";
const { issue, presign } = vi.hoisted(() => ({ issue: vi.fn(), presign: vi.fn() }));
vi.mock("@vercel/blob", () => ({ issueSignedToken: issue, presignUrl: presign }));
const document = (): WardrobeDocument => ({ _id: "00000000-0000-4000-8000-000000000001", type: "shirt", sourceSha256: "a".repeat(64),
  images: { original: { pathname: "original", contentType: "image/jpeg" }, cutout: { pathname: "cutout", contentType: "image/png" },
    thumbnails: [{ pathname: "thumb", contentType: "image/webp", width: 640, height: 640, sha256: "b".repeat(64), version: "v1" }] },
  createdAt: new Date(), updatedAt: new Date(), deletedAt: null });
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); delete process.env.WARDROBE_IMAGE_DELIVERY;
  issue.mockImplementation(async () => ({ validUntil: Date.now() + 600_000, delegationToken: "server-delegation", clientSigningToken: "server-key" }));
  presign.mockImplementation(async (_token, options) => ({ presignedUrl: `https://store.private.blob.vercel-storage.com/${options.pathname}?signed=opaque` }));
});
describe("private signed delivery", () => {
  it("deduplicates token issuance across concurrent pages and returns individual read URLs only", async () => {
    const { toDeliveryItems } = await import("@/lib/storage/delivery");
    const [items] = await Promise.all([toDeliveryItems([document()]), toDeliveryItems([document()])]);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(issue).toHaveBeenCalledWith(expect.objectContaining({ operations: ["get"] }));
    expect(items[0].images.thumbnails?.[0]).toMatchObject({ width: 640, url: expect.stringContaining("/thumb?") });
    expect(items[0].images.expiresAt! - Date.now()).toBeLessThanOrEqual(120_000);
    expect(JSON.stringify(items)).not.toMatch(/server-key|server-delegation/);
    expect(presign.mock.calls.every(([, options]) => options.operation === "get" && options.useCache === true && options.access === "private")).toBe(true);
  });
  it("renews signing material before it can truncate an image lease", async () => {
    const { toDeliveryItems } = await import("@/lib/storage/delivery");
    const time = Date.now(); vi.spyOn(Date, "now").mockReturnValue(time);
    await toDeliveryItems([document()]);
    vi.mocked(Date.now).mockReturnValue(time + 500_000);
    await toDeliveryItems([document()]); expect(issue).toHaveBeenCalledTimes(2); vi.restoreAllMocks();
  });
  it("recovers after an issuance failure and never signs removed items", async () => {
    const { toDeliveryItems } = await import("@/lib/storage/delivery");
    issue.mockRejectedValueOnce(new Error("offline"));
    await expect(toDeliveryItems([document()])).rejects.toThrow("offline");
    expect(await toDeliveryItems([document()])).toHaveLength(1);
    await expect(toDeliveryItems([{ ...document(), deletedAt: new Date() }])).rejects.toThrow("removed");
    expect(issue).toHaveBeenCalledTimes(2);
  });
  it("supports proxy rollback without contacting Blob signing", async () => {
    process.env.WARDROBE_IMAGE_DELIVERY = "proxy";
    const { toDeliveryItems } = await import("@/lib/storage/delivery");
    expect((await toDeliveryItems([document()]))[0].images.cutout).toMatch(/^\/api\/items\//);
    expect(issue).not.toHaveBeenCalled();
  });
});
