import { expect, it, vi } from "vitest";
import sharp from "sharp";
import type { ImageStore, StoredThumbnail, WardrobeDocument } from "@/lib/contracts/persistence";
import { generateThumbnails, sha256, THUMBNAIL_VERSION } from "@/lib/images/generate-thumbnails";
import { backfillThumbnails } from "../../scripts/backfill-thumbnails";
const doc = (): WardrobeDocument => ({ _id: "item", sourceSha256: "a".repeat(64), type: "shirt", images: { cutout: { pathname: "cutout", contentType: "image/png" }, original: { pathname: "original", contentType: "image/jpeg" } }, createdAt: new Date(), updatedAt: new Date(), deletedAt: null });
async function fixture() {
  const bytes = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 10, g: 100, b: 40, alpha: .5 } } }).png().toBuffer();
  const objects = new Map<string, Uint8Array>();
  const store: ImageStore = { readPrivate: vi.fn(async () => ({ body: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), contentType: "image/png" })),
    putPrivate: vi.fn(async (pathname, bytes, contentType) => { objects.set(pathname, bytes); return { pathname, contentType }; }) };
  return { bytes, objects, store };
}
it("generates bounded WebPs with transparency and byte hashes", async () => {
  const { bytes } = await fixture(); const outputs = await generateThumbnails(bytes);
  expect(outputs.map(image => image.width)).toEqual([320, 480, 640]);
  for (const image of outputs) {
    expect(await sharp(image.bytes).metadata()).toMatchObject({ format: "webp", width: image.width, height: image.height, hasAlpha: true });
    expect(image.sha256).toBe(sha256(image.bytes));
  }
});
it("backfill dry-run makes no storage or database writes", async () => {
  const { store } = await fixture(); const attach = vi.fn();
  const report = await backfillThumbnails([doc()], { imageStore: store, attach }, true);
  expect(report.planned).toEqual(["item"]); expect(store.readPrivate).not.toHaveBeenCalled(); expect(store.putPrivate).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled();
});
it("recovers after attachment failure, reuses immutable paths, and skips completed/removed items", async () => {
  const { store, objects } = await fixture(); const item = doc();
  const attach = vi.fn().mockResolvedValueOnce(false).mockImplementation(async (_id, _path, images: StoredThumbnail[]) => { item.images.thumbnails = images; return true; });
  const first = await backfillThumbnails([item], { imageStore: store, attach });
  expect(first.failed).toHaveLength(1); expect(first.unreferencedObjects).toHaveLength(3);
  const retry = await backfillThumbnails([item], { imageStore: store, attach });
  expect(retry.updated).toEqual(["item"]); expect(retry.unreferencedObjects).toEqual([]); expect(objects.size).toBe(3);
  expect(item.images.thumbnails?.every(image => image.version === THUMBNAIL_VERSION)).toBe(true);
  const done = await backfillThumbnails([item, { ...doc(), _id: "removed", deletedAt: new Date() }], { imageStore: store, attach });
  expect(done.skipped).toEqual(["item", "removed"]); expect(attach).toHaveBeenCalledTimes(2);
});
