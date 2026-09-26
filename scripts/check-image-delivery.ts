import { config } from "dotenv";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { performance } from "node:perf_hooks";
async function main() {
config({ path: ".env.local", quiet: true });
const { getWardrobeRepository } = await import("../src/lib/data/wardrobe-repository");
const { closeDatabase } = await import("../src/lib/data/mongodb");
try {
  const document = (await getWardrobeRepository().listActive())[0];
  if (!document) throw new Error("No active images to check.");
  const pathname = document.images.thumbnails?.at(-1)?.pathname ?? document.images.cutout.pathname;
  const { toDeliveryItems } = await import("../src/lib/storage/delivery");
  const { ItemDTOSchema } = await import("../src/lib/contracts/wardrobe");
  ItemDTOSchema.parse((await toDeliveryItems([document]))[0]);
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil: Date.now() + 60_000 });
  const results = [];
  let unsignedStatus: number | undefined;
  for (let index = 0; index < 2; index++) {
    const { presignedUrl } = await presignUrl(token, { pathname, access: "private", operation: "get", validUntil: Date.now() + 30_000, useCache: true });
    if (index === 0) {
      const unsigned = new URL(presignedUrl); unsigned.search = "";
      const response = await fetch(unsigned, { signal: AbortSignal.timeout(15_000) });
      unsignedStatus = response.status; await response.body?.cancel();
      if (unsignedStatus !== 403) throw new Error("Unsigned private image GET must be rejected.");
    }
    const start = performance.now();
    const response = await fetch(presignedUrl, { signal: AbortSignal.timeout(15_000) });
    const headersMs = performance.now() - start;
    const bytes = (await response.arrayBuffer()).byteLength;
    results.push({ status: response.status, bytes, headersMs: Math.round(headersMs), totalMs: Math.round(performance.now() - start), contentType: response.headers.get("content-type"), cacheControl: response.headers.get("cache-control"), cache: response.headers.get("x-vercel-cache") });
    if (!response.ok) throw new Error("Signed image GET failed.");
  }
  const { presignedUrl } = await presignUrl(token, { pathname, access: "private", operation: "get", validUntil: Date.now() + 1000 });
  await new Promise(resolve => setTimeout(resolve, 2100));
  const expired = await fetch(presignedUrl, { signal: AbortSignal.timeout(15_000) });
  await expired.body?.cancel();
  console.log(JSON.stringify({ results, unsignedStatus, expiredStatus: expired.status }, null, 2));
  if (expired.status !== 403) throw new Error("Expired image URL remained usable over the network.");
} catch {
  console.error("Direct delivery check failed. No URLs or signing credentials were logged."); process.exitCode = 1;
} finally { await closeDatabase(); }

}
void main().catch(() => { console.error("Image delivery check failed."); process.exitCode = 1; });
