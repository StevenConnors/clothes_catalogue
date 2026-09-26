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

After inspecting a classified batch’s review sheets, approve it with `npm run wardrobe:approve -- --batch first-batch --all` (or `--items 1,3-5`). Add `--accept-warnings` only to accept flagged cutouts as-is. Then run the import dry-run and import commands in [setup](docs/setup.md). [Photo quality](docs/photo-quality.md) explains hanger/rack remnants and capture improvements.
