import { loadBatch, validatePreparedEntry } from "./lib/batch-files";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ImportReportSchema, type ImportReport } from "../src/lib/contracts/batch";
import type { ClothingType } from "../src/lib/contracts/wardrobe";
import type { ImageStore, WardrobeDocument, WardrobeRepository } from "../src/lib/contracts/persistence";

export interface ImportAdapters {
  repository: WardrobeRepository;
  imageStore: ImageStore;
  uuid?: () => string;
}
export interface ImportOptions { batch: string; dryRun?: boolean; root?: string; }

const validBatch = (s: string) => /^[A-Za-z0-9_-]+$/.test(s);
function reportFor(batchId: string): ImportReport { return { batchId, imported: [], skipped: [], failed: [] }; }

/** Core function is adapter-injectable for deterministic fixture and failure-recovery checks. */
export async function importBatch(options: ImportOptions, adapters: ImportAdapters): Promise<{ report: ImportReport; planned: Array<{ sourceSha256: string; type: string }>; unreferencedObjects: string[] }> {
  if (!validBatch(options.batch)) throw new Error("invalid batch ID");
  const root = path.resolve(options.root ?? process.cwd());
  const { manifest: parsed, processed, incoming } = await loadBatch(root, options.batch);
  const report = reportFor(parsed.batchId);
  const planned: Array<{ sourceSha256: string; type: string }> = [];
  const unreferencedObjects: string[] = [];
  const entries = parsed.entries;
  const hashes = new Set<string>();
  for (const entry of entries) {
    if (hashes.has(entry.sourceSha256)) {
      report.failed.push({ sourceSha256: entry.sourceSha256, message: "manifest contains a repeated source digest" });
      continue;
    }
    hashes.add(entry.sourceSha256);
    if (entry.reviewStatus !== "approved") {
      report.skipped.push({ sourceSha256: entry.sourceSha256, reason: "not_approved" });
      continue;
    }
    let type: ClothingType;
    let source: Buffer;
    let cutout: Buffer;
    let sourceType: "image/jpeg" | "image/png";
    try {
      ({ source, cutout, sourceType, type } = await validatePreparedEntry(incoming, processed, entry));
    } catch (error) {
      report.failed.push({ sourceSha256: entry.sourceSha256, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    try {
      const existing = await adapters.repository.findBySourceHash(entry.sourceSha256);
      if (existing) {
        report.skipped.push({ sourceSha256: entry.sourceSha256, reason: existing.deletedAt ? "previously_removed" : "already_exists", itemId: existing._id });
        continue;
      }
      planned.push({ sourceSha256: entry.sourceSha256, type });
      if (options.dryRun) continue;
      const sourceExt = sourceType === "image/jpeg" ? "jpg" : "png";
      const originalPath = `wardrobe/${entry.sourceSha256}/original.${sourceExt}`;
      const original = await adapters.imageStore.putPrivate(originalPath, source, sourceType);
      unreferencedObjects.push(original.pathname);
      const cutoutPath = `wardrobe/${entry.sourceSha256}/cutout-${entry.cutoutSha256}.png`;
      const cutoutImage = await adapters.imageStore.putPrivate(cutoutPath, cutout, "image/png");
      unreferencedObjects.push(cutoutImage.pathname);
      const now = new Date();
      const document: WardrobeDocument = {
        _id: (adapters.uuid ?? randomUUID)(), sourceSha256: entry.sourceSha256, type,
        images: { original, cutout: cutoutImage }, createdAt: now, updatedAt: now, deletedAt: null,
      };
      const inserted = await adapters.repository.insertIfAbsent(document);
      if (inserted.inserted) {
        report.imported.push({ sourceSha256: entry.sourceSha256, itemId: inserted.document._id });
        unreferencedObjects.splice(unreferencedObjects.indexOf(original.pathname), 1);
        unreferencedObjects.splice(unreferencedObjects.indexOf(cutoutImage.pathname), 1);
      } else {
        const retained = new Set([inserted.document.images.original.pathname, inserted.document.images.cutout.pathname]);
        for (const pathname of retained) {
          const orphanIndex = unreferencedObjects.indexOf(pathname);
          if (orphanIndex >= 0) unreferencedObjects.splice(orphanIndex, 1);
        }
        report.skipped.push({ sourceSha256: entry.sourceSha256, reason: inserted.document.deletedAt ? "previously_removed" : "already_exists", itemId: inserted.document._id });
      }
    } catch (error) {
      report.failed.push({ sourceSha256: entry.sourceSha256, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { report: ImportReportSchema.parse(report), planned, unreferencedObjects };
}

async function cli(): Promise<void> {
  config({ path: path.resolve(process.cwd(), ".env.local"), override: false });
  const args = process.argv.slice(2);
  const batchArg = args.indexOf("--batch");
  const batch = batchArg >= 0 ? args[batchArg + 1] : undefined;
  const dryRun = args.includes("--dry-run");
  if (!batch || !validBatch(batch)) throw new Error("usage: npm run wardrobe:import -- --batch <batch-id> [--dry-run]");
  // Import lazily so the core can be exercised with fixture adapters without credentials.
  const [{ getWardrobeRepository }, { getImageStore }] = await Promise.all([
    import("../src/lib/data/wardrobe-repository"), import("../src/lib/storage/blob"),
  ]);
  const { closeDatabase } = await import("../src/lib/data/mongodb");
  const root = path.resolve(process.cwd());
  try {
    const { report, planned, unreferencedObjects } = await importBatch({ batch, dryRun, root }, { repository: await getWardrobeRepository(), imageStore: await getImageStore() });
    const reportPath = path.join(root, "wardrobe-data", "processed", batch, "import-report.json");
    const reportTemp = `${reportPath}.tmp`;
    await fs.writeFile(reportTemp, `${JSON.stringify({ ...report, planned, unreferencedObjects }, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(reportTemp, reportPath);
    if (dryRun) console.log(`Planned inserts: ${planned.length}; skipped: ${report.skipped.length}; failed: ${report.failed.length}`);
    else console.log(`Imported: ${report.imported.length}; skipped: ${report.skipped.length}; failed: ${report.failed.length}`);
    if (report.failed.length) process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  cli().catch((error) => { console.error(`import-batch: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; });
}
