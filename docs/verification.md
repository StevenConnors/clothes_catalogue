> The stored-thumbnail and signed-delivery implementation has newer checks in [image delivery verification](image-delivery-verification.md). The initial scaffold results below remain historical.

# Verification — 2026-09-26

## Infinite scroll follow-up — 2026-09-26

The catalogue now adapts the infinite-loading pattern in `~/github/me/components/photos/PhotosGallery.tsx`: a server-rendered first page of 24, an 800px IntersectionObserver margin, cursor-based loading, a manual Load more/Retry control, ID deduplication, and cancellation on filter changes. Category order and private owner authorization are preserved. Existing `/api/items` calls without pagination parameters still return the full listing.

- Node 24: `npm run typecheck`, `npm run lint`, and `npm run build` passed. Typecheck was rerun after the build because running both simultaneously initially raced Next.js's generated type files.
- `PATH="$PWD/.venv/bin:/opt/homebrew/opt/node@24/bin:$PATH" WARDROBE_TEST_PYTHON="$PWD/.venv/bin/python" npm test`: 60 TypeScript tests and 6 Python tests passed. New tests cover category boundaries, equal timestamps, deleted items, malformed/filter-mismatched cursors, authorization, concurrent loads, deduplication, retries, unavailable observers, and aborted requests.
- Read-only real MongoDB checks paged all 15 currently active records in batches of two and separately paged all six clothing filters. Results matched the complete listing in category/newest order with no omissions or duplicates. No records or indexes were changed.
- An isolated headless Chrome harness rendered the actual `WardrobeGrid` with synthetic records and replacements for Next.js image/link components. On 390×844 and 1000×600 viewports, native IntersectionObserver loaded 24 → 48 → 49 cards with exactly two requests, removed the loading control at exhaustion, and produced no duplicate cards, horizontal overflow, or page errors. Screenshots were visually inspected at ignored `test-results/infinite-scroll-phone.png` and `test-results/infinite-scroll-desktop.png`. This verifies browser scrolling separately from live owner authentication and image delivery; the authenticated live E2E suite was not run for this change.
- The category pagination index is included in `scripts/setup-indexes.ts`; run `npm run wardrobe:indexes` when applying the change to a configured environment.

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

## Live first-batch follow-up — 2026-09-26

This update supersedes the missing-input statements above for the first-batch import. The owner supplied service configuration and six real photographs. All six source/cutout pairs were visually inspected: one jacket/outer and five pants. Garments remain recognizable, but all cutouts retain hanger/exercise-rack parts; these findings were recorded in the local manifest. The owner explicitly approved importing all six as-is. Only those exact reviewed entries were marked approved after rechecking source/cutout digests.

- `npm run wardrobe:indexes`: passed against configured MongoDB.
- `npm run wardrobe:import -- --batch first-batch --dry-run`: six planned inserts, zero skips/failures.
- `npm run wardrobe:import -- --batch first-batch`: six imported, zero skips/failures.
- Read-only real-adapter verification: six active records, twelve private stored images read with digests matching unchanged sources/reviewed cutouts. Active counts: one outer, five pants, total six. Evidence: ignored `wardrobe-data/verification/first-batch-live-check.json` and batch import report.
- The owner's real three-photo benchmark reports ARM64 Python 3.12.12, 181.77 seconds session initialization including the first model download, per-image durations 16.35/16.05/14.83 seconds, and peak process RSS 6,150,684,672 bytes (about 5.73 GiB). All three attempts report success. These are recorded measurements, not estimates; the coordinator did not independently verify CPU model/physical memory.

The live MongoDB/private Blob import and private SDK reads now pass. Signed-in website rendering, authenticated HTTP image responses, UI correction/removal flows, and disposable E2E checks remain pending browser verification. Deployment remains not requested. Real-photo quality has been reviewed with the retained-background limitation explicitly accepted by the owner; the app does not promise these cutouts are clean.

## Batch approval CLI and mask-quality follow-up (2026-09-26)

Added `wardrobe:approve` for whole batches, exclusions, and numbered selections. Approval validates review-index hashes, source/cutout bytes, decoded images, clothing type, warnings, and rejection state before atomically updating the local manifest. Dry-run and repeated approval do not change bytes; a failed selected entry prevents all selected approvals. Approval performs no MongoDB/Blob operations.

Validation passed: 31 Vitest tests, 6 Python tests, typecheck, and lint. New tests cover approval selection, exclusions, warning acceptance, rejected/unclassified entries, stale mappings, changed bytes, symlink rejection, dry-run, idempotence, and pending → approval → importer integration using fixture adapters. Actual CLI help and first-batch approval dry-run passed: all six entries already approved, no manifest changes. No new live records or catalogue images were written during this update.

A separate real-photo crop trial on review entry 5 used cached BiRefNet CPU weights: 6.00 seconds initialization and 17.82 seconds processing. Visual inspection found less rack but remaining clips/handle/rod; it is not a fully clean result. The candidate stays in ignored local experiment files. See photo-quality.md for the capture recommendations, proposed prompted-segmentation trial, and existing-import replacement limitation.
