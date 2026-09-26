import { config } from "dotenv";
import path from "node:path";
import { promises as fs } from "node:fs";
import { generateThumbnails, uploadThumbnails, THUMBNAIL_VERSION } from "../src/lib/images/generate-thumbnails";
import type { ImageStore, WardrobeDocument, StoredThumbnail } from "../src/lib/contracts/persistence";

export async function backfillThumbnails(documents: WardrobeDocument[], adapters: {
  imageStore: ImageStore; attach: (id: string, cutoutPath: string, thumbnails: StoredThumbnail[]) => Promise<boolean>;
}, dryRun = false) {
  const report = { planned: [] as string[], updated: [] as string[], skipped: [] as string[], failed: [] as { id: string; message: string }[], unreferencedObjects: [] as string[] };
  for (const document of documents) {
    const existing = document.images.thumbnails ?? [];
    const complete = existing.length > 0 && existing.every(image => image.version === THUMBNAIL_VERSION) && (existing.some(image => image.width === 640) && existing.length === 3 || existing.length === 1 && existing[0].width <= 320);
    if (document.deletedAt || complete) { report.skipped.push(document._id); continue; }
    report.planned.push(document._id);
    if (dryRun) continue;
    try {
      const found = await adapters.imageStore.readPrivate(document.images.cutout);
      if (!found) throw new Error("Cutout is missing.");
      const bytes = Buffer.from(await new Response(found.body).arrayBuffer());
      const images = await uploadThumbnails(document.sourceSha256, await generateThumbnails(bytes), adapters.imageStore, report.unreferencedObjects);
      if (!await adapters.attach(document._id, document.images.cutout.pathname, images)) throw new Error("Item was removed or its cutout changed during backfill.");
      for (const image of images) report.unreferencedObjects.splice(report.unreferencedObjects.indexOf(image.pathname), 1);
      report.updated.push(document._id);
    } catch (error) { report.failed.push({ id: document._id, message: error instanceof Error ? error.message : "Backfill failed." }); }
  }
  return report;
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  async function cli() {
  config({ path: ".env.local", quiet: true });
  const { getWardrobeRepository, attachThumbnails } = await import("../src/lib/data/wardrobe-repository");
  const { getImageStore } = await import("../src/lib/storage/blob");
  const { closeDatabase } = await import("../src/lib/data/mongodb");
  try {
    const report = await backfillThumbnails(await getWardrobeRepository().listActive(), { imageStore: getImageStore(), attach: attachThumbnails }, process.argv.includes("--dry-run"));
    const reportPath = path.resolve("wardrobe-data/thumbnail-backfill-report.json");
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(`${reportPath}.tmp`, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(`${reportPath}.tmp`, reportPath);
    console.log(JSON.stringify({ planned: report.planned.length, updated: report.updated.length, skipped: report.skipped.length, failed: report.failed.length, unreferenced: report.unreferencedObjects.length }));
    if (report.failed.length) process.exitCode = 1;
  } finally { await closeDatabase(); }
  }
  void cli().catch(() => { console.error("Backfill failed; check service configuration."); process.exitCode = 1; });
}
