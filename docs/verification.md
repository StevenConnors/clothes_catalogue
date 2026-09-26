# Verification — 2026-09-26

The implementation is complete and integrated. The private live workflow is **not yet verified**: no service credentials, real OAuth owner session, or garment photographs were supplied. Deployment was not requested.

## Completion gates

| Gate | Status | Evidence / remaining work |
| --- | --- | --- |
| Implementation and integration | passed | Next.js pages, guarded APIs, lazy MongoDB/private Blob adapters, shared Zod contracts, preparation/review/import scripts, and documentation are integrated. No app mock catalogue, public upload, classification endpoint, or auth bypass exists. |
| Build and focused tests | passed | Strict typecheck, clean ESLint, production build without secrets, 23 TypeScript tests and 6 Python tests. npm audit reports zero vulnerabilities. |
| Reproducible workflow | passed | Exercised preparation, review mapping, decoded image/hash/path validation, dry-run, injected partial import recovery, deduplication, type correction preservation, and hidden-record preservation. Repository/storage doubles and deterministic masks were used; these checks do not prove live adapters or model quality. |
| Live services and browser | pending-input | No MongoDB URI, private Blob credentials/store, or GitHub OAuth configuration/session available. Anonymous HTTP/browser checks passed, but signed-in gallery, private live import, images and mutations require those inputs. |
| Real-photo quality and hardware | pending-input | Native ARM64 Python 3.12.12/rembg/ONNX installation/import verified on macOS 15.2. No real photos or model weights supplied; no real-model session, garment inspection, hardware inference benchmark or initial 20-item batch was performed. |
| Deployment | not-requested | No resources provisioned and no deployment URL. Production smoke checks remain required if deployment is requested. |

## Commands and results

Final checks used a temporary Node 24 installation at `/private/tmp/wardrobe-node/node_modules/.bin` and project `.venv` Python 3.12.12. Node 24 is the supported project runtime; the host default is Node 23.11.0. The temporary Python base is documented in setup and should be replaced with a persistent installation for long-term use.

```sh
PATH="$PWD/.venv/bin:/private/tmp/wardrobe-node/node_modules/.bin:$PATH" \
  WARDROBE_TEST_PYTHON="$PWD/.venv/bin/python" npm test
PATH="/private/tmp/wardrobe-node/node_modules/.bin:$PATH" npm run typecheck
PATH="/private/tmp/wardrobe-node/node_modules/.bin:$PATH" npm run lint
PATH="/private/tmp/wardrobe-node/node_modules/.bin:$PATH" npm run build
.venv/bin/python -m py_compile scripts/prepare-batch.py scripts/review-sheet.py
npm audit
```

All passed. The build emits the catalogue, detail, sign-in and API routes, with authenticated pages rendered dynamically and no live connection during compilation. Browser bundle searches found no occurrences of MongoDB URI, Blob read/write token, GitHub secret variable, or Blob host references. DTOs are tested to contain authenticated same-origin image paths.

`npm run test:e2e` was actually attempted and exited nonzero with an actionable missing-prerequisites error. It is a pending live gate, not a passing browser suite. Configure the dedicated disposable instance and real OAuth session described in [setup](setup.md), then rerun it. Phone/desktop tests check rendering, counts, private images and persisted correction; the desktop removal check uses a separate explicitly disposable fixture.

`npm run wardrobe:indexes` was attempted without credentials and correctly exited nonzero with “MongoDB is not configured.” A CLI dry-run of an all-pending synthetic batch skipped all three entries with no writes. After the test runner approved two synthetic entries, CLI dry-run reported two missing-service failures, one pending skip and zero planned inserts; no uploads/inserts occurred. Its report is in the ignored fixture folder. This confirms error reporting, not a live import.

## Flow evidence and limits

- **A, folder to catalogue:** Python orchestration tests create JPEG fixtures, preserve original hashes, exercise one-session sequential preparation with `--limit 3 --benchmark`, and produce pending 1024×1024 RGBA files. Review sheets and hash mappings are tested. A separate cross-language test carries actual Python-transformed PNG files through the TypeScript importer: two approved inserts are planned with zero writes during dry-run, then inserted using injected adapters while a third remains pending. Original bytes are preserved. Real service insertion and owner browsing remain pending.
- **B, correction and filtering:** Guarded route tests validate strict PATCH bodies, malformed UUIDs, global counts with filtered totals, origin rejection and successful mutations. The cross-language fixture changes a stored type, reruns its old manifest, and proves correction survives. Refresh/back navigation and failed-mutation UI behavior are implemented but still need the real owner browser gate.
- **C, removal:** Route tests cover repeated DELETE, hidden image/detail protection; fixture import proves hidden source hashes stay hidden. The live browser suite checks confirmation, retained record/private objects and decremented totals against a disposable fixture; it has not run.
- **D, recovery:** Unsupported HEIC is explicitly reported; deterministic empty masks fail and do not produce approved cutouts. Injected upload/insert failure records leftover objects, retries safely and keeps unique storage paths/documents. Digest tampering, all-transparent PNG, traversal, escaping file symlink, reviewed regeneration and source changes are tested. These do not establish segmentation quality on garments.
- **E, services:** Server integration tests distinguish missing Blob objects (404), unavailable service (503), and application failure (500). Private adapter tests verify immutable byte matching, missing-object upload and concurrent upload reuse. Real SDK calls remain pending service access.

The preparation and review commands also ran on an explicitly synthetic three-entry local batch, using an injected deterministic mask in the test runner. `scripts/review-sheet.py --batch verification-fixture` generated a sheet which was opened and visually inspected: three source/cutout pairs, unchanged proportions, separate regions retained, white display surfaces, and consistent entry numbers. Useful ignored files:

- `wardrobe-data/processed/verification-fixture/manifest.json`
- `wardrobe-data/processed/verification-fixture/review-001.png`
- `wardrobe-data/processed/verification-fixture/review-index.json`
- `wardrobe-data/processed/verification-fixture/benchmark.json` — synthetic mask timings only, **not a real-model benchmark**
- `wardrobe-data/processed/verification-fixture/import-report.json`

The normal website does not read these local fixtures; none were imported into real services.

## Browser checks actually performed

Development server initially hit macOS watcher limits after installing the Python environment. Using Webpack, ignored `.venv`/photo folders, and polling fixed the dev server. The browser CLI failed to launch sandboxed Chrome; the connected in-app browser was used as fallback. Home navigation reached `/sign-in`, displayed the explicit setup-required state, and had no console errors/warnings or Next.js error overlay. A narrow viewport showed no horizontal overflow (the browser reported actual CSS width 300px despite requesting 390px). Visual screenshots were inspected in the task; no owner catalogue screenshot exists.

Actual anonymous HTTP requests to `/api/items`, item detail JSON, original image, and cutout image each returned 401 JSON with `Cache-Control: private, no-store`. Non-owner 403 and hidden-item denials were tested through the server harness, not by fabricating a browser session.

## Resume live verification

1. Fill `.env.local` locally with the values from `.env.example`; do not paste secrets in messages. Run `npm run wardrobe:indexes`.
2. Start `npm run dev`, then complete GitHub OAuth with the configured immutable owner account.
3. Place three representative real JPEG/PNG garment photographs in `wardrobe-data/incoming/first-batch/` and run `.venv/bin/python scripts/prepare-batch.py --batch first-batch --limit 3 --benchmark`. Compare all sources and cutouts; report measured initialization, per-image duration and peak RSS. Owner approval follows visual review.
4. Generate review sheets, classify by actual inspection, approve only owner-selected entries, dry-run and import as documented. Verify private bytes, counts, correction, removal and safe rerun against real services. Use a separate disposable database/tracked fixtures for destructive verification.
5. Run `npm run test:e2e` with the real owner session and dedicated environment. Store session/screenshots locally in ignored paths.

Three implementation agents were requested with `gpt-6-luna`, Medium reasoning, and no inherited history. Spawn results supplied task IDs but no resolved-model metadata; actual model selection could not be independently verified. Their returned work was reviewed, corrected and integrated by the coordinator. No recursive delegation occurred.
