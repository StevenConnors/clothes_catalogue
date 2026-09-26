import sharp from "sharp";
import type { StoredImage } from "@/lib/contracts/persistence";
import { getImageStore } from "./blob";

// Immutable storage paths make these safe to reuse across requests. The route
// must check ownership and active-item status before consulting this cache.
const cache = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer | null>>();
const maxBytes = 16 * 1024 * 1024;
const maxEntries = 128;
let cachedBytes = 0;

export async function readThumbnail(image: StoredImage): Promise<Buffer | null> {
  const key = image.pathname;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const existing = pending.get(key);
  if (existing) return existing;

  const task = (async () => {
    const found = await getImageStore().readPrivate(image);
    if (!found) return null;
    const input = Buffer.from(await new Response(found.body).arrayBuffer());
    const output = await sharp(input)
      .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, alphaQuality: 100 })
      .toBuffer();
    if (output.length <= maxBytes) {
      while (cache.size && (cachedBytes + output.length > maxBytes || cache.size >= maxEntries)) {
        const oldest = cache.keys().next().value!;
        cachedBytes -= cache.get(oldest)!.length;
        cache.delete(oldest);
      }
      cache.set(key, output);
      cachedBytes += output.length;
    }
    return output;
  })();
  pending.set(key, task);
  try { return await task; }
  finally { pending.delete(key); }
}
