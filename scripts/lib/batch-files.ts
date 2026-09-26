import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BatchIdSchema, BatchManifestSchema, type BatchEntry } from '../../src/lib/contracts/batch';

export async function readInside(base: string, relative: string): Promise<Buffer> {
  if (!relative || path.isAbsolute(relative)) throw new Error('path must be relative to its batch folder');
  const target = path.resolve(base, relative);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error('path escapes its batch folder');
  const [realBase, realTarget] = await Promise.all([fs.realpath(base), fs.realpath(target)]);
  if (!realTarget.startsWith(`${realBase}${path.sep}`)) throw new Error('symlink path escapes its batch folder');
  if (!(await fs.lstat(target)).isFile()) throw new Error('entry path is not a regular file');
  return fs.readFile(realTarget);
}

export async function loadBatch(root: string, batch: string) {
  BatchIdSchema.parse(batch);
  root = path.resolve(root);
  const processed = path.join(root, 'wardrobe-data', 'processed', batch);
  const incoming = path.join(root, 'wardrobe-data', 'incoming', batch);
  for (const folder of [path.join(root, 'wardrobe-data'), path.dirname(processed), processed, path.dirname(incoming), incoming]) {
    if ((await fs.lstat(folder)).isSymbolicLink()) throw new Error('batch directory may not be a symlink');
  }
  const manifestBytes = await readInside(processed, 'manifest.json');
  const manifest = BatchManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
  if (manifest.batchId !== batch) throw new Error('manifest batch ID does not match requested batch');
  const hashes = manifest.entries.map(e => e.sourceSha256);
  if (new Set(hashes).size !== hashes.length) throw new Error('manifest contains a repeated source digest');
  return { manifest, manifestBytes, processed, incoming };
}

async function validateImage(bytes: Buffer, needRgba: boolean): Promise<'image/jpeg' | 'image/png'> {
  const pipeline = sharp(bytes, { failOn: 'error', limitInputPixels: 100_000_000 });
  const metadata = await pipeline.metadata();
  if (!['jpeg', 'png'].includes(metadata.format ?? '')) throw new Error('image must decode as JPEG or PNG');
  if (!metadata.width || !metadata.height) throw new Error('image has invalid dimensions');
  if (needRgba) {
    if (metadata.format !== 'png' || metadata.channels !== 4) throw new Error('cutout must be an RGBA PNG');
    const { data, info } = await pipeline.clone().raw().toBuffer({ resolveWithObject: true });
    let foreground = false;
    for (let i = 3; i < data.length; i += info.channels) if (data[i] > 0) { foreground = true; break; }
    if (!foreground) throw new Error('cutout alpha channel is empty');
  } else await pipeline.clone().toBuffer();
  return metadata.format === 'jpeg' ? 'image/jpeg' : 'image/png';
}

export async function validatePreparedEntry(incoming: string, processed: string, entry: BatchEntry) {
  if (!entry.type || !entry.cutoutPath || !entry.cutoutSha256) throw new Error('entry requires a clothing type and prepared cutout');
  const source = await readInside(incoming, entry.sourcePath);
  if (createHash('sha256').update(source).digest('hex') !== entry.sourceSha256) throw new Error('source digest mismatch');
  const sourceType = await validateImage(source, false);
  const cutout = await readInside(processed, entry.cutoutPath);
  if (createHash('sha256').update(cutout).digest('hex') !== entry.cutoutSha256) throw new Error('cutout digest mismatch');
  await validateImage(cutout, true);
  return { source, sourceType, cutout, type: entry.type };
}
