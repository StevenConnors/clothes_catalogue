# Setup and operation

Use Node.js 24 LTS and npm. Dependencies are pinned in package.json/package-lock.json. Auth.js is pinned to 5.0.0-beta.32 (the documented v5 interface); test OAuth against your GitHub app before production use. There is no OpenAI API key or remotely invoked classification service.

## Services and local sign-in

1. The development script uses Webpack with ignored photo/virtual-environment folders and polling to avoid macOS watcher limits. Run `npm ci`, copy `.env.example` to `.env.local`, and fill its values. Keep this file private. Generate AUTH_SECRET with `openssl rand -base64 32`.
2. Create/reuse MongoDB Atlas, allow the laptop/deployment network, and obtain a restricted database connection URI. Set MONGODB_URI and MONGODB_DB. Images never go in MongoDB. Run `npm run wardrobe:indexes` before importing: source hashes are unique even after removal.
3. Create/reuse a **private** Vercel Blob store. For local Node scripts set BLOB_READ_WRITE_TOKEN. For a connected Vercel deployment use BLOB_STORE_ID and the SDK's platform-managed OIDC credentials. Do not copy OIDC tokens into code or committed environment files. Do not use a public store.
4. Create a GitHub OAuth application. Set AUTH_GITHUB_ID and AUTH_GITHUB_SECRET. Its local callback is `http://localhost:3000/api/auth/callback/github`; production callback is `https://<your-host>/api/auth/callback/github`. Separate OAuth apps for local and production simplify callback management. Obtain your immutable numeric account ID from GitHub's authenticated `/user` API or `https://api.github.com/users/<your-login>` and set AUTH_ALLOWED_GITHUB_ID to that ID, not the login. Only that identity may sign in, and each request rechecks it.
5. Run `npm run dev` and open http://localhost:3000. Sign in with the allowlisted GitHub account. OAuth requires your interactive consent. Missing services produce errors; they never produce a pretend empty catalogue.

The website only reads the catalogue, corrects clothing types, and hides records. It has no image uploads or classification endpoints. The six types are Jacket / outer, Shirt, T-shirt, Pants, Shorts, and Shoes. A pair of shoes is one item. Removal preserves records and private images; repeat imports do not restore removed items.

## Local photo environment

Use native ARM64 Python 3.12 on the M1 Pro. Confirm `uname -m` reports arm64, `python3.12 -c 'import platform; print(platform.machine())'` reports arm64, and `sw_vers -productVersion` is compatible with the pinned ONNX Runtime macOS wheel (macOS 14 or newer). The implementation machine reported macOS 15.2 and ARM64; this does not establish a real-photo benchmark.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements.txt
```

If Python 3.12 is missing, install a native build using your Python manager. For example `uv python install 3.12` followed by `uv venv --python 3.12 .venv`. rembg uses CPU inference and explicitly selects birefnet-general. Initial session creation downloads model weights into the local cache; later runs reuse them. The model runs locally, with one reused session and exactly one photograph in flight. No GPU/Core ML setup is required. First-time download can take time and is included in measured initialization.

Photograph garments individually, laid flat or hanging against a simple background. Export HEIC to JPEG first. Keep JPEG/PNG originals in `wardrobe-data/incoming/<batch-id>/`; batch IDs use letters, digits, underscores, and hyphens. All wardrobe-data, reports, review sheets, sessions, and environment files are Git ignored. Never put photos in public assets or commit them.

```sh
mkdir -p wardrobe-data/incoming/first-batch
# Copy three representative real JPEG/PNG photos here first.
.venv/bin/python scripts/prepare-batch.py --batch first-batch --limit 3 --benchmark
.venv/bin/python scripts/review-sheet.py --batch first-batch
```

Inspect `wardrobe-data/processed/first-batch/benchmark.json`: report session initialization separately from each image duration and peak process memory. Do not claim acceptable hardware performance until three real photos complete without memory failure. Visually compare sources and cutouts for missing sleeves/straps/logos, changed colours, background remnants, and both shoes. Only then process the initial batch of up to 20 items with a normal preparation run.

Use [the reusable Codex prompt](codex-photo-workflow.md) for visual classification and review. Classification uses your interactive signed-in Codex subscription; the scripts do not call a paid AI API. Manifest entries start unclassified and pending. Only your approval can move reviewed entries to approved. Numbered review sheets have at most four entries per page and a digest mapping in review-index.json. Unknown garments remain unclassified; do not force a seventh category.

```sh
.venv/bin/python scripts/prepare-batch.py --batch first-batch
.venv/bin/python scripts/review-sheet.py --batch first-batch
npm run wardrobe:import -- --batch first-batch --dry-run
# After reviewed entries are approved and dry-run validation succeeds:
npm run wardrobe:import -- --batch first-batch
```

Dry-run checks paths, decoded files, hashes, review state, and existing records without writing to Blob/MongoDB. Its plan lists intended inserts separately; imported stays empty until real inserts succeed. Exact source-byte duplicates are skipped; different photos of the same garment are not detected as duplicates. Review state is local and is not a website feature.

## Recovery

Failed masks remain pending/rejected with diagnostics. Preserve originals, improve the source photograph if necessary, then explicitly regenerate an existing entry:

```sh
.venv/bin/python scripts/prepare-batch.py --batch first-batch --reprocess <source-sha256>
.venv/bin/python scripts/review-sheet.py --batch first-batch
```

Reprocessing retains the type but resets approval. Review again before approving. Changed source bytes create a new pending entry. Do not edit approved cutouts by hand: digest mismatches block import. A changed cutout gets a new content-addressed Blob pathname after review.

If import partially fails, inspect the ignored import-report.json, fix the reported cause, repeat dry-run then import. Successful records are retained/skipped, immutable uploaded files are verified/reused, and no incomplete document is inserted. Unreferenced uploaded files are identified for inspection; there is no broad deletion. Existing manual type corrections remain intact. Missing paths, paths outside the batch, and symlinks escaping it are rejected.

## Checks and live browser tests

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` needs Pillow on the selected Python interpreter; the deterministic Python fixtures do not need downloaded model weights. Prefer the project virtual environment when installed (`PATH="$PWD/.venv/bin:$PATH" npm test`). The ordinary app always uses real adapters; test doubles are confined to tests.

For `npm run test:e2e`, create a **separate** `.env.local`/app instance using a disposable database named `wardrobe_e2e_<run-id>` and the same real OAuth owner setup. Run on port 3100 (`npm run dev -- --port 3100`) and configure the OAuth callback accordingly. Prepare/import synthetic fixture items only. Track each created Blob pathname; never clean up a shared store or the normal catalogue. Set E2E_BASE_URL, E2E_AUTH_STATE, E2E_ITEM_ID, E2E_REMOVAL_ITEM_ID, MONGODB_URI, and MONGODB_DB for the test process. E2E_ITEM_ID must be an active fixture UUID in that disposable database. E2E_REMOVAL_ITEM_ID must be a different active disposable fixture UUID; the desktop test hides it and verifies the record and Blob bytes remain.

Save a real session, for example `npx playwright codegen --save-storage=.auth/owner.json http://localhost:3100`, complete GitHub sign-in, then close the browser. Set E2E_AUTH_STATE=.auth/owner.json. Install Chromium if needed with `npx playwright install chromium`. Tests verify anonymous denials, phone/desktop rendering, images, counts, API persistence, and type correction, then restore the fixture type. They do not spoof OAuth or provide an auth bypass. Missing prerequisites fail with an actionable error. Removal/reimport/partial-failure fixture scenarios are exercised by focused tests; their live counterparts remain separate verification gates.

Only remove the explicitly created disposable database and tracked test objects once the run is complete. Record baseline counts and the objects created before cleanup. Do not use broad storage deletion.

## Deployment

Deployment was not requested. Code and environment templates are ready for the owner's Vercel workflow: import the repository, use Node 24, configure the environment above, connect the private Blob store, set production OAuth callback, create MongoDB indexes, then deploy. No resources are provisioned or paid services created automatically. Production verification must include real owner sign-in, images, filter navigation, anonymous denials, and an owner-approved temporary type correction restored afterwards. Local fixture checks do not establish production verification.

Official references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Auth.js GitHub](https://authjs.dev/getting-started/providers/github), [restricting access](https://authjs.dev/guides/restricting-user-access), [Blob SDK/authentication](https://vercel.com/docs/vercel-blob/using-blob-sdk), [MongoDB Node driver](https://www.mongodb.com/docs/drivers/node/current/), [rembg](https://github.com/danielgatis/rembg), [ONNX wheels](https://pypi.org/project/onnxruntime/#files).

Implementation-session Python note: a working `.venv` was created with native Python 3.12.12 stored under `/private/tmp/wardrobe-python/`. This temporary base may be removed by the OS. Recreate `.venv` with a persistent installed Python 3.12 before long-term use. No model weights were downloaded and no real-photo segmentation was run.
