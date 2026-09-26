import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";

// Offline profiler: no credentials, uploads, or changes to source images.
// node scripts/profile-images.mjs <output.json> <manifest.json> [...]
const [outputPath, ...manifestPaths] = process.argv.slice(2);
if (!outputPath || !manifestPaths.length) throw new Error("Provide an output JSON path and at least one batch manifest.");
const rows = [];
for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const entry of manifest.entries.filter(entry => entry.reviewStatus === "approved")) {
    const input = await readFile(resolve(dirname(manifestPath), entry.cutoutPath));
    const metadata = await sharp(input).metadata();
    const variants = [];
    for (const width of [320, 480, 640, 960]) {
      const times = [];
      let bytes;
      for (let repeat = 0; repeat < 3; repeat++) {
        const start = performance.now();
        const result = await sharp(input).resize({ width, height: width, fit: "inside", withoutEnlargement: true }).webp({ quality: 80, alphaQuality: 100 }).toBuffer();
        times.push(performance.now() - start);
        bytes = result.length;
      }
      times.sort((a, b) => a - b);
      variants.push({ width, bytes, medianEncodeMs: Number(times[1].toFixed(2)) });
    }
    // Record anonymous sample numbers, never local filenames or source hashes.
    rows.push({ sample: rows.length + 1, type: entry.type, width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha, pngBytes: input.length, variants });
  }
}
const sum = values => values.reduce((a, b) => a + b, 0);
const totals = [320, 480, 640, 960].map(width => {
  const variants = rows.map(row => row.variants.find(variant => variant.width === width));
  const bytes = sum(variants.map(variant => variant.bytes));
  const pngBytes = sum(rows.map(row => row.pngBytes));
  return { width, bytes, reductionPercent: Number((100 * (1 - bytes / pngBytes)).toFixed(2)), meanOfMedianEncodeMs: Number((sum(variants.map(variant => variant.medianEncodeMs)) / rows.length).toFixed(2)) };
});
const output = { generatedAt: new Date().toISOString(), runtime: { node: process.version, arch: process.arch, platform: process.platform, sharp: sharp.versions.sharp }, method: "3 in-memory encodes per image/width, median per image; aggregate encode time is mean of per-image medians. Local CPU only; not Vercel latency.", count: rows.length, pngBytes: sum(rows.map(row => row.pngBytes)), totals, rows };
await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ count: output.count, pngBytes: output.pngBytes, totals }, null, 2));
