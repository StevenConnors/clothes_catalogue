import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { prepareThumbnails } from "./prepare-thumbnails";
async function main() {
const args = process.argv.slice(2);
const python = process.env.WARDROBE_PYTHON || (existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3");
const result = spawnSync(python, [path.resolve("scripts/prepare-batch.py"), ...args], { stdio: "inherit" });
if (result.error || result.status !== 0) process.exit(result.status || 1);
const batch = args[args.indexOf("--batch") + 1];
if (args.includes("--help") || args.includes("-h")) return;
const rows = await prepareThumbnails(batch);
console.log(`Prepared thumbnails for ${rows.length} cutouts.`);

}
void main().catch(() => { console.error("Batch preparation failed."); process.exitCode = 1; });
