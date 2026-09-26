import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadBatch, readInside } from "./lib/batch-files";
import { generateThumbnails, sha256 } from "../src/lib/images/generate-thumbnails";

export async function prepareThumbnails(batch: string, root = process.cwd()) {
  const { manifest, processed } = await loadBatch(root, batch);
  const entries = [];
  for (const entry of manifest.entries) {
    if (!entry.cutoutPath || !entry.cutoutSha256 || entry.reviewStatus === "rejected") continue;
    const cutoutBytes = await readInside(processed, entry.cutoutPath);
    if (sha256(cutoutBytes) !== entry.cutoutSha256) throw new Error("cutout digest mismatch");
    const thumbnails = [];
    for (const { bytes, ...metadata } of await generateThumbnails(cutoutBytes)) {
      const filename = `thumbnail-${metadata.width}-${metadata.sha256}.webp`;
      const temporary = path.join(processed, `.${randomUUID()}.tmp`);
      await fs.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, path.join(processed, filename));
      thumbnails.push({ ...metadata, path: filename });
    }
    entries.push({ sourceSha256: entry.sourceSha256, cutoutSha256: entry.cutoutSha256, thumbnails });
  }
  const temporary = path.join(processed, `.${randomUUID()}.tmp`);
  await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, batchId: batch, entries }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await fs.rename(temporary, path.join(processed, "thumbnails.json"));
  return entries;
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const args = process.argv.slice(2); const batch = args[args.indexOf("--batch") + 1];
  if (!args.includes("--batch") || !batch) throw new Error("usage: wardrobe:thumbnails -- --batch <batch-id>");
  prepareThumbnails(batch).then(rows => console.log(`Prepared thumbnails for ${rows.length} cutouts.`)).catch(() => { console.error("Thumbnail preparation failed; check batch files and cutout hashes."); process.exitCode = 1; });
}
