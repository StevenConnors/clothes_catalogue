# Personal wardrobe

A private, single-owner wardrobe catalogue. Browse garment cutouts, filter six clothing types, correct a type, view originals, and hide items. Photos are prepared locally and imported only after review; the website has no upload or AI endpoint.

Start with [setup](docs/setup.md), then use the [photo-batch workflow](docs/codex-photo-workflow.md). [Verification](docs/verification.md) records actual checks and remaining live gates. The full implementation contract is in [implementation specification](docs/implementation-spec.md).

```sh
npm ci
cp .env.example .env.local
# Configure OAuth, MongoDB Atlas and private Blob as documented.
npm run wardrobe:indexes
npm run dev
```

`npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` check implementation. `npm run test:e2e` requires a separate live test instance and real owner session; it fails clearly when prerequisites are absent.

## Approve and import a photo batch

Prepare and classify photos using the [photo-batch workflow](docs/codex-photo-workflow.md), then generate and inspect the numbered review sheets. Replace `first-batch` below with your batch ID.

```sh
.venv/bin/python scripts/review-sheet.py --batch first-batch
open wardrobe-data/processed/first-batch/review-*.png

# Preview approval without changing the manifest.
npm run wardrobe:approve -- --batch first-batch --all --dry-run

# Approve the whole reviewed batch.
npm run wardrobe:approve -- --batch first-batch --all

# Alternatively, approve specific review-sheet numbers or exclude some.
npm run wardrobe:approve -- --batch first-batch --items 1,3-5
npm run wardrobe:approve -- --batch first-batch --all --except 3,8
```

Choose one approval command for your selection. Every selected entry must have a clothing type, valid source/cutout files, matching hashes, and a current review-sheet mapping. Unclassified or rejected entries block approval; if any selected entry fails validation, nothing is approved. Assign uncertain types in `wardrobe-data/processed/<batch-id>/manifest.json` and regenerate and inspect the sheets, or exclude those entries.

Entries with warnings also block approval unless you add `--accept-warnings` to your chosen command. This explicitly accepts the selected cutouts **as-is**, including recorded segmentation defects; it does not fix them. You can combine it with `--dry-run` to preview. [Photo quality](docs/photo-quality.md) explains hanger/rack remnants and capture improvements.

Approval only updates the local manifest. After approval, refresh the sheet status labels, inspect the import dry-run, and import only if validation succeeds:

```sh
.venv/bin/python scripts/review-sheet.py --batch first-batch
npm run wardrobe:import -- --batch first-batch --dry-run
npm run wardrobe:import -- --batch first-batch
```

Import includes only approved entries. Service configuration and recovery instructions are in [setup](docs/setup.md).
