# Stored thumbnails and private signed delivery — 2026-09-27

The grid now receives signed GET URLs for stored WebP derivatives. Owner authorization and active-item queries happen before URL issuance. Normal backfilled grid delivery has no per-image application request, PNG download, or Sharp encoding. Individual URLs last two minutes; server-only GET signing material is reused for up to ten minutes, with renewal before it can truncate an image lease. New immutable uploads have a 30-day Blob cache lifetime. Signing expiry does not erase previously downloaded browser data.

## Implementation and recovery

- One Sharp generator produces 320/480/640-pixel transparent WebPs (quality 80, alpha quality 100), without enlarging small inputs. Output hashes and transformation versions appear in immutable filenames.
- `wardrobe:prepare` wraps the existing sequential Python preparation and writes local derivatives plus a separate `thumbnails.json`. The approval manifest remains compatible and unchanged by thumbnail preparation. Import derives thumbnails from the validated approved PNG using the same encoder.
- Backfill attaches metadata only while the item remains active and its cutout pathname still matches. Item IDs, type and timestamps are preserved. Uploaded objects remain available for retries, with unreferenced objects reported rather than deleted.
- Catalogue, detail and refresh responses issue only individual URLs. The refresh endpoint checks owner authorization, validates at most 48 IDs, queries active items together and uses `private, no-store` response caching.
- Client refresh requests are batched/deduplicated. Near-viewport unloaded images refresh before expiry or on return to a tab. Loaded images are retained. An image error gets one automatic URL refresh; detail views also offer manual retry. Global foreground listeners are shared.
- `WARDROBE_IMAGE_DELIVERY=proxy` rolls delivery back to the existing authenticated routes.

## Checks performed

`npm test`: **80 TypeScript tests and 6 Python tests passed**. These cover import approval/integrity and recovery, private immutable storage, generation/transparency, backfill failure recovery, token issuance deduplication/renewal/recovery, owner authorization, bounded refresh batches, response caching, delayed image expiry, foreground return and bounded retries.

`npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed. The new refresh API is a dynamic route. No new dependency was required by the application.

The preparation wrapper and standalone thumbnail command both ran successfully against the existing local synthetic verification batch. No background-removal session was rerun and no approval was changed.

## Live Blob and database checks

- Direct signed PNG GET before migration: 631,669 bytes; first request CDN MISS, second request HIT. Header wait measured 1,303 ms then 25 ms. A short-lived URL tested after expiry returned 403.
- Backfill dry-run: 15 planned, zero failed.
- Actual backfill: **15 updated**, zero failed, zero unreferenced uploads. The resulting documents contain **45 thumbnail references**.
- Rerun: **15 skipped**, zero planned/updated/failed/unreferenced.
- Direct signed 640-pixel WebP for the same sample: **42,900 bytes**. First MISS completed in 984 ms; the subsequent HIT completed in 24 ms. A later check returned HITs completing in 146 ms and 40 ms. These individual observations are not a production latency guarantee.
- The live signed item DTO passed the client schema. Unsigned and expired private GETs both returned **403**. Different freshly minted URLs for the same object benefited from CDN caching.

The migration uses the configured existing private Blob store and MongoDB catalogue. Original photos and approved cutouts were retained. The backfill report lives in the Git-ignored `wardrobe-data/thumbnail-backfill-report.json`.

## Browser checks and limits

An isolated browser checked the local production build (with `AUTH_TRUST_HOST=true` for the temporary localhost server; the initial run identified this missing local production-mode setting): anonymous navigation rendered the GitHub sign-in screen without JavaScript errors. Anonymous catalogue, URL-refresh and image requests returned 401 with `private, no-store` headers.

A temporary local browser harness bundled the actual `PrivateImage` component with short-lived signed URLs for the existing 15 items and the application grid CSS. All 15 images loaded from private Blob, with no JavaScript errors. Image request completion endpoints ranged from 701 to 811 ms after navigation in that single capture. The desktop and 390-by-844 phone viewports had no horizontal overflow; the phone selected stored 320-pixel variants. The rendered images were visually inspected.

This harness eagerly requested all images and did not include catalogue SSR, owner OAuth, pagination/navigation or mutation requests. It verifies the real image component and direct assets, **not a controlled full-page production speedup**. Signed-in navigation/mutations and repeated normal/throttled production profiles still need verification on the deployed build with an owner session. Existing destructive E2E tests remain restricted to a disposable database and owner session; they were not run against the normal catalogue.

The code has not been deployed by this task. Deployment and a signed-in production smoke/profile are the remaining rollout steps. Temporary HTML containing signed URLs is excluded from the repository and removed after browser verification.
