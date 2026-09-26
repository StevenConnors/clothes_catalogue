import { config } from "dotenv";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { BatchManifestSchema, ImportReportSchema, type BatchManifest, type ImportReport } from "../src/lib/contracts/batch";
import type { ImageStore, WardrobeDocument, WardrobeRepository } from "../src/lib/contracts/persistence";

export interface ImportAdapters {
  repository: WardrobeRepository;
  imageStore: ImageStore;
  uuid?: () => string;
}
export interface ImportOptions { batch: string; dryRun?: boolean; root?: string; }

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const validBatch = (s: string) => /^[A-Za-z0-9_-]+$/.test(s);
function inside(base: string, relative: string): string {
  if (!relative || path.isAbsolute(relative)) throw new Error("path must be relative to its batch folder");
  const resolved = path.resolve(base, relative);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new Error("path escapes its batch folder");
  return resolved;
}
async function readInside(base: string, relative: string): Promise<Buffer> {
  const target = inside(base, relative);
  const realBase = await fs.realpath(base);
  const realTarget = await fs.realpath(target);
  if (realTarget !== realBase && !realTarget.startsWith(`${realBase}${path.sep}`)) throw new Error("symlink path escapes its batch folder");
  const stat = await fs.lstat(target);
  if (!stat.isFile()) throw new Error("entry path is not a regular file");
  return fs.readFile(realTarget);
}

async function validateImage(bytes: Buffer, allowed: Array<"jpeg" | "png">, needRgba = false): Promise<"image/jpeg" | "image/png"> {
  const pipeline = sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 });
  const metadata = await pipeline.metadata();
  if (!metadata.format || !allowed.includes(metadata.format as "jpeg" | "png")) throw new Error("image must decode as JPEG or PNG");
  if (!metadata.width || !metadata.height || metadata.width < 1 || metadata.height < 1) throw new Error("image has invalid dimensions");
  if (needRgba) {
    if (metadata.format !== "png" || (metadata.channels ?? 0) < 4) throw new Error("cutout must be an RGBA PNG");
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let foreground = false;
    for (let i = 3; i < data.length; i += info.channels) if (data[i] > 0) { foreground = true; break; }
    if (!foreground) throw new Error("cutout alpha channel is empty");
  }
  // metadata() alone can accept truncated files; force the full decode before import.
  await pipeline.clone().toBuffer();
  return metadata.format === "jpeg" ? "image/jpeg" : "image/png";
}

function reportFor(batchId: string): ImportReport { return { batchId, imported: [], skipped: [], failed: [] }; }

/** Core function is adapter-injectable for deterministic fixture and failure-recovery checks. */
export async function importBatch(options: ImportOptions, adapters: ImportAdapters): Promise<{ report: ImportReport; planned: Array<{ sourceSha256: string; type: string }>; unreferencedObjects: string[] }> {
  if (!validBatch(options.batch)) throw new Error("invalid batch ID");
  const root = path.resolve(options.root ?? process.cwd());
  const processed = path.resolve(root, "wardrobe-data", "processed", options.batch);
  const incoming = path.resolve(root, "wardrobe-data", "incoming", options.batch);
  for (const folder of [path.join(root, "wardrobe-data"), path.join(root, "wardrobe-data", "processed"), processed,
    path.join(root, "wardrobe-data", "incoming"), incoming]) {
    if ((await fs.lstat(folder)).isSymbolicLink()) throw new Error(`batch directory may not be a symlink: ${folder}`);
  }
  const processedParent = await fs.realpath(path.dirname(processed));
  const incomingParent = await fs.realpath(path.dirname(incoming));
  const realProcessed = await fs.realpath(processed);
  const realIncoming = await fs.realpath(incoming);
  if (!realProcessed.startsWith(`${processedParent}${path.sep}`) || !realIncoming.startsWith(`${incomingParent}${path.sep}`)) throw new Error("batch folder symlink escapes wardrobe-data");
  const parsed = BatchManifestSchema.parse(JSON.parse((await readInside(realProcessed, "manifest.json")).toString("utf8"))) as BatchManifest;
  if (parsed.batchId !== options.batch) throw new Error("manifest batch ID does not match requested batch");
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
    let source: Buffer;
    let cutout: Buffer;
    let sourceType: "image/jpeg" | "image/png";
    try {
      if (!entry.type || !entry.cutoutPath || !entry.cutoutSha256) throw new Error("approved entry requires a type and prepared cutout");
      source = await readInside(incoming, entry.sourcePath);
      if (sha(source) !== entry.sourceSha256) throw new Error("source digest mismatch");
      sourceType = await validateImage(source, ["jpeg", "png"]);
      cutout = await readInside(processed, entry.cutoutPath);
      if (sha(cutout) !== entry.cutoutSha256) throw new Error("cutout digest mismatch");
      await validateImage(cutout, ["png"], true);
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
      planned.push({ sourceSha256: entry.sourceSha256, type: entry.type });
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
        _id: (adapters.uuid ?? randomUUID)(), sourceSha256: entry.sourceSha256, type: entry.type,
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
