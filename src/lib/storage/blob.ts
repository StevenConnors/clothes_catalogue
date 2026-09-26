import { createHash } from "node:crypto";
import { get, put, BlobNotFoundError } from "@vercel/blob";
import type { ImageStore, StoredImage } from "@/lib/contracts/persistence";

const digestBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function readExisting(pathname: string): Promise<{ pathname: string; bytes: Buffer } | null> {
  let result;
  try {
    result = await get(pathname, { access: "private", useCache: false });
  } catch (error) {
    if (error instanceof BlobNotFoundError || (error as { status?: number }).status === 404) return null;
    throw error;
  }
  if (!result || result.statusCode !== 200) return null;
  const chunks: Uint8Array[] = [];
  const reader = result.stream.getReader();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
  }
  return { pathname: result.blob.pathname, bytes: Buffer.concat(chunks) };
}

export function getImageStore(): ImageStore {
  return {
    async putPrivate(pathname, bytes, contentType) {
      const digest = digestBytes(bytes);
      const verifyExisting = async (): Promise<StoredImage | null> => {
        const existing = await readExisting(pathname);
        if (!existing) return null;
        if (digestBytes(existing.bytes) !== digest) {
          throw new Error("An immutable private image already exists with different content.");
        }
        return { pathname: existing.pathname, contentType };
      };

      const prior = await verifyExisting();
      if (prior) return prior;
      try {
        const blob = await put(pathname, Buffer.from(bytes), {
          access: "private", addRandomSuffix: false, allowOverwrite: false, contentType,
          cacheControlMaxAge: 30 * 24 * 60 * 60,
        });
        return { pathname: blob.pathname, contentType };
      } catch (putError) {
        // Another importer may have won the immutable pathname race. Reuse only after verifying bytes.
        const concurrent = await verifyExisting();
        if (concurrent) return concurrent;
        throw putError;
      }
    },
    async readPrivate(image) {
      try {
        // Imported objects are immutable; private CDN reads avoid origin latency.
        const result = await get(image.pathname, { access: "private", useCache: true });
        if (!result || result.statusCode !== 200 || !result.stream) return null;
        return { body: result.stream, contentType: result.blob.contentType || image.contentType };
      } catch (error) {
        if (error instanceof BlobNotFoundError || (error as { status?: number }).status === 404) return null;
        throw error;
      }
    },
  };
}
