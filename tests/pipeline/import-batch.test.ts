import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { ImageStore, WardrobeDocument, WardrobeRepository } from "../../src/lib/contracts/persistence";
import { approveBatch } from "../../scripts/approve-batch";
import { importBatch } from "../../scripts/import-batch";

const tempRoots: string[] = [];
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wardrobe-import-")); tempRoots.push(root);
  const incoming = path.join(root, "wardrobe-data/incoming/demo");
  const processed = path.join(root, "wardrobe-data/processed/demo");
  await fs.mkdir(incoming, { recursive: true }); await fs.mkdir(processed, { recursive: true });
  const source = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).jpeg().toBuffer();
  const cutout = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer();
  await fs.writeFile(path.join(incoming, "shirt.jpg"), source); await fs.writeFile(path.join(processed, "cutout.png"), cutout);
  const entry = { sourcePath: "shirt.jpg", sourceSha256: hash(source), type: "shirt", cutoutPath: "cutout.png", cutoutSha256: hash(cutout), model: "birefnet-general", warnings: [], reviewStatus: "approved" };
  await fs.writeFile(path.join(processed, "manifest.json"), JSON.stringify({ schemaVersion: 1, batchId: "demo", entries: [entry] }));
  const docs = new Map<string, WardrobeDocument>(); const writes: string[] = []; const objects = new Map<string, string>(); let failInsert = false;
  const repository: WardrobeRepository = {
    async listActive() { return [...docs.values()].filter((x) => !x.deletedAt); },
    async countActiveByType() { return { outer: 0, shirt: 0, tshirt: 0, pants: 0, shorts: 0, shoes: 0 }; },
    async getActiveById(id) { return docs.get(id) ?? null; },
    async findBySourceHash(value) { return [...docs.values()].find((x) => x.sourceSha256 === value) ?? null; },
    async insertIfAbsent(doc) { if (failInsert) throw new Error("injected insert failure"); const current = [...docs.values()].find((x) => x.sourceSha256 === doc.sourceSha256); if (current) return { inserted: false, document: current }; docs.set(doc._id, doc); return { inserted: true, document: doc }; },
    async updateType() { return null; }, async softDelete() { return false; },
  };
  const imageStore: ImageStore = {
    async putPrivate(name, bytes) { writes.push(name); const digest = hash(bytes); const old = objects.get(name); if (old && old !== digest) throw new Error("immutable path content conflict"); objects.set(name, digest); return { pathname: name, contentType: name.endsWith(".png") ? "image/png" : "image/jpeg" }; },
    async readPrivate() { return null; },
  };
  return { root, source, cutout, repository, imageStore, docs, writes, objects, setFail: (v: boolean) => { failInsert = v; } };
}
afterEach(async () => { await Promise.all(tempRoots.splice(0).map((p) => fs.rm(p, { recursive: true, force: true }))); });

describe("importBatch", () => {
  it("imports pending files only after numbered CLI approval", async () => {
    const f = await fixture(); const folder = path.join(f.root, "wardrobe-data/processed/demo");
    const manifestPath = path.join(folder, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")); manifest.entries[0].reviewStatus = "pending";
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await fs.writeFile(path.join(folder, "review-index.json"), JSON.stringify({ batchId: "demo", entries: [{ number: 1, sourceSha256: hash(f.source), cutoutSha256: hash(f.cutout) }] }));
    const adapters = { repository: f.repository, imageStore: f.imageStore };
    expect((await importBatch({ batch: "demo", root: f.root }, adapters)).report.skipped[0]?.reason).toBe("not_approved");
    expect(f.writes).toHaveLength(0);
    await approveBatch({ batch: "demo", root: f.root, items: "1" });
    expect((await importBatch({ batch: "demo", root: f.root }, adapters)).report.imported).toHaveLength(1);
    expect(f.docs.size).toBe(1);
  });
  it("dry run validates and plans without writes", async () => {
    const f = await fixture(); const result = await importBatch({ batch: "demo", root: f.root, dryRun: true }, { repository: f.repository, imageStore: f.imageStore });
    expect(result.planned).toHaveLength(1); expect(result.report.imported).toHaveLength(0); expect(f.writes).toHaveLength(0); expect(f.docs.size).toBe(0);
  });
  it("resumes after upload then document insert failure and reuses content paths", async () => {
    const f = await fixture(); f.setFail(true);
    let result = await importBatch({ batch: "demo", root: f.root }, { repository: f.repository, imageStore: f.imageStore });
    expect(result.report.failed).toHaveLength(1); expect(f.docs.size).toBe(0); expect(f.writes).toHaveLength(2);
    expect(f.objects.size).toBe(2); expect(result.unreferencedObjects).toHaveLength(2);
    f.setFail(false); result = await importBatch({ batch: "demo", root: f.root }, { repository: f.repository, imageStore: f.imageStore });
    expect(result.report.imported).toHaveLength(1); expect(f.docs.size).toBe(1); expect(f.writes).toHaveLength(4);
    expect(f.objects.size).toBe(2); expect(result.unreferencedObjects).toHaveLength(0);
  });
  it("rejects a changed cutout digest without uploading", async () => {
    const f = await fixture(); const p = path.join(f.root, "wardrobe-data/processed/demo/cutout.png"); await fs.writeFile(p, Buffer.from("tampered"));
    const result = await importBatch({ batch: "demo", root: f.root }, { repository: f.repository, imageStore: f.imageStore });
    expect(result.report.failed[0]?.message).toMatch(/cutout digest mismatch/); expect(f.writes).toHaveLength(0);
  });
  it("rejects symlinks escaping a batch folder", async () => {
    const f = await fixture(); const incoming = path.join(f.root, "wardrobe-data/incoming/demo");
    await fs.rename(path.join(incoming, "shirt.jpg"), path.join(f.root, "outside.jpg")); await fs.symlink(path.join(f.root, "outside.jpg"), path.join(incoming, "shirt.jpg"));
    const result = await importBatch({ batch: "demo", root: f.root }, { repository: f.repository, imageStore: f.imageStore });
    expect(result.report.failed[0]?.message).toMatch(/symlink path escapes/); expect(f.writes).toHaveLength(0);
  });
  it("rejects a manifest path that traverses out of its batch", async () => {
    const f = await fixture();
    const manifestPath = path.join(f.root, "wardrobe-data/processed/demo/manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")); manifest.entries[0].sourcePath = "../../../../outside.jpg";
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const result = await importBatch({ batch: "demo", root: f.root }, { repository: f.repository, imageStore: f.imageStore });
    expect(result.report.failed[0]?.message).toMatch(/escapes/); expect(f.writes).toHaveLength(0);
  });
  it("rejects an all-transparent RGBA cutout", async () => {
    const f = await fixture(); const processed = path.join(f.root, "wardrobe-data/processed/demo");
    const empty = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    await fs.writeFile(path.join(processed, "cutout.png"), empty);
    const manifestPath = path.join(processed, "manifest.json"); const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.entries[0].cutoutSha256 = hash(empty); await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const result = await importBatch({ batch: "demo", root: f.root }, { repository: f.repository, imageStore: f.imageStore });
    expect(result.report.failed[0]?.message).toMatch(/alpha channel is empty/); expect(f.writes).toHaveLength(0);
  });
  it("reports previously removed source hashes and never restores them", async () => {
    const f = await fixture(); const old = { _id: randomUUID(), sourceSha256: hash(f.source), type: "shorts" as const, images: { original: { pathname: "old", contentType: "image/jpeg" as const }, cutout: { pathname: "old-cut", contentType: "image/png" as const } }, createdAt: new Date(), updatedAt: new Date(), deletedAt: new Date() };
    f.docs.set(old._id, old);
    const result = await importBatch({ batch: "demo", root: f.root }, { repository: f.repository, imageStore: f.imageStore });
    expect(result.report.skipped[0]?.reason).toBe("previously_removed"); expect(f.docs.size).toBe(1); expect(f.writes).toHaveLength(0);
  });
});
