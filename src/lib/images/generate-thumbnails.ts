import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ImageStore, StoredThumbnail } from "../contracts/persistence";

export const THUMBNAIL_WIDTHS = [320, 480, 640] as const;
export const THUMBNAIL_VERSION = "webp-q80-alpha100-v1";
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function generateThumbnails(cutout: Buffer) {
  const metadata = await sharp(cutout, { limitInputPixels: 100_000_000, failOn: "error" }).metadata();
  if (metadata.format !== "png" || !metadata.hasAlpha) throw new Error("Thumbnails require an alpha PNG cutout.");
  const outputs: { bytes: Buffer; width: number; height: number; sha256: string; version: string }[] = [];
  for (const width of THUMBNAIL_WIDTHS) {
    const { data, info } = await sharp(cutout).resize({ width, height: width, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });
    outputs.push({ bytes: data, width: info.width, height: info.height, sha256: sha256(data), version: THUMBNAIL_VERSION });
  }
  // Small fixtures/inputs may produce the same dimensions at every requested size.
  return outputs.filter((output, index) => outputs.findIndex(other => other.width === output.width) === index);
}

export async function uploadThumbnails(sourceSha256: string, outputs: Awaited<ReturnType<typeof generateThumbnails>>, store: ImageStore,
  unreferencedObjects: string[] = []): Promise<StoredThumbnail[]> {
  const thumbnails: StoredThumbnail[] = [];
  for (const output of outputs) {
    const pathname = `wardrobe/${sourceSha256}/thumbnail-${output.version}-${output.width}-${output.sha256}.webp`;
    const image = await store.putPrivate(pathname, output.bytes, "image/webp");
    unreferencedObjects.push(image.pathname);
    thumbnails.push({ ...image, contentType: "image/webp", width: output.width, height: output.height, sha256: output.sha256, version: output.version });
  }
  return thumbnails;
}
