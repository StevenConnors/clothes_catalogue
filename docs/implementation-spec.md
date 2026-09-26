# Implementation prompt: personal wardrobe catalogue

Paste the entire file into the coordinating Codex agent in the repository where you want the app built, with your chosen GPT-6 coordinator set to Medium reasoning. This is an instruction to implement the app in that repository. It includes the shared contracts, three bounded subagent assignments, and a separate prompt for processing future photo batches.

## 1. Your role and the outcome

Act as the coordinating engineer and implement this app now. Keep the owner's selected GPT-6 coordinator and Medium reasoning setting. After scaffolding and defining shared contracts, explicitly spawn three implementation subagents with model `gpt-6-luna` and `medium` reasoning. You own dependency choices, integration, debugging, and all completion gates. Continue from implementation through verification; a plan or three agent summaries alone do not satisfy this request.

**Delegation contract:**

- This prompt explicitly authorizes the three implementation subagents in section 13. Use the available native subagent tools. Request `gpt-6-luna` explicitly for each agent; do not assume it inherits that model from the coordinator.
- In a harness exposing `collaboration.spawn_agent`, supply `model: "gpt-6-luna"`, `reasoning_effort: "medium"`, and `fork_turns: "none"`. Give each agent the full shared specification and its bounded assignment in its initial message or in repository files it is told to read. Respect the tool's current schema if it differs.
- Preserve this specification in `docs/implementation-spec.md` before spawning agents so it is available in the repository and after context compaction. Pass the exact path and the relevant contract paths to every agent.
- Inspect the model reported by the spawn result or available agent metadata and state the actual model when reporting delegation. If the harness does not report the resolved model, distinguish the requested model from an unverified result.
- Use at most three concurrent implementation subagents; if fewer slots are available, run assignments in waves. Agents must return their work to the coordinator and must not recursively spawn more agents for these tasks.
- If Luna or explicit model selection is unavailable, report the limitation and carry out the affected work in the coordinator. Do not quietly spawn inherited-model agents and describe them as Luna. Do not change global Codex configuration or use API-key subprocesses to emulate delegation.
- Wait for all assigned work, review it, and integrate it before the final completion report. While agents work, handle independent coordinator tasks. Route failures and contract changes through the coordinator.

Codex supports explicit subagent model and reasoning choices; defaults and custom agent configurations can also affect the resolved settings. A prompt cannot override unavailable tools or account restrictions. [Official subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents)

The owner wants to remember and use the clothing they already own and reduce unnecessary purchases. The product should make adding a batch and browsing the wardrobe easy. Keep the interface quiet and simple.

The implementation succeeds when the owner can go from a folder of phone photos to a reviewed, private catalogue, browse it on a phone, correct a clothing type, and safely add another batch later. Exact-file duplicates, a failed import, and an incorrect cutout must each have an understandable recovery path. The only required owner input is access to missing services, any interactive sign-in, real photos, and decisions on reviewed items. Resolve routine implementation choices autonomously.

The normal workflow is:

1. The owner photographs an individual garment, or a pair of shoes, on their phone.
2. They export JPEG or PNG photos into a local repository folder.
3. They ask their signed-in Codex agent to inspect the photos and assign clothing types.
4. A local segmentation script removes the background, preserving the photographed item's appearance.
5. Codex compares the resulting cutouts with the source photos and prepares a batch for review.
6. After the owner asks to import the reviewed batch, a local script uploads the images to private storage and inserts metadata into MongoDB.
7. The owner browses the private website on their phone or laptop.

The website does not perform classification or segmentation. The Codex subscription is used interactively in the local processing workflow. Do not treat that subscription as an inference service that the deployed website can call. Codex supports signing in with ChatGPT for subscription access; this is separate from API-key access. [Official Codex authentication documentation](https://learn.chatgpt.com/docs/auth)

## 2. Fixed scope

Implement:

- Single-user sign-in and authorization.
- A responsive grid of garment cutouts on white backgrounds.
- An All filter and six clothing-type filters, with counts.
- An item view containing a larger cutout, a way to view the original photo, and a clothing-type selector.
- A small Remove from catalogue action with confirmation. Removal hides the item; it preserves stored images and the database record.
- Local preparation and import scripts.
- A reusable Codex prompt for future photo batches.

The only descriptive metadata is clothing type. Do not add names, brands, colours, purchase dates, prices, wear counts, tags, notes, outfits, wishlists, recommendations, or analytics. Technical identifiers, image references, timestamps, and processing information are allowed because the implementation needs them.

Do not add website uploads, AI endpoints, scheduled processing, a queue, a chat interface, a native mobile app, background-removal editing tools, or multiple accounts. Do not require an OpenAI API key, Vercel AI Gateway, or a paid image-processing API. Do not put personal photographs in Git or the public assets directory.

One source photo represents one catalogue item in v1. A photographed pair of shoes is one item. Photograph items alone, laid flat or hanging against an uncluttered background. Photos of someone wearing several garments need review rather than automatic import. Ask the owner to export HEIC photos as JPEG for v1; do not silently skip unsupported files.

## 3. Technologies and setup decisions

Reuse compatible conventions and dependencies if the repository already contains a Next.js app. Otherwise create one application with the following stack:

| Concern | Technology / decision |
| --- | --- |
| Web app | Next.js App Router, React, TypeScript with strict checking |
| Styling | Tailwind CSS; simple components; use existing shadcn/ui components if already installed |
| Hosting | Vercel, Node.js runtime for application API routes |
| Metadata | MongoDB Atlas with the official `mongodb` driver |
| Images | Private Vercel Blob store with `@vercel/blob` |
| Authentication | Existing auth if suitable; otherwise Auth.js with GitHub OAuth, JWT sessions, and one allowlisted GitHub account |
| Validation | Zod for shared TypeScript runtime schemas |
| Local import | TypeScript executed with `tsx`; explicitly load `.env.local` |
| Local cutouts | Python 3.12, Pillow, `rembg` CPU inference, explicitly selecting `birefnet-general` |
| Verification | Existing test tools if present; otherwise Vitest for TypeScript checks, Python unittest for transformations, and Playwright for repeatable browser flows |

The coordinator must check official documentation for the installed SDKs and compatible current versions before scaffolding. Pin the versions actually installed and commit the lockfile. Do not ask subagents to install independently or change the package manager. Preserve an existing package manager; use npm for a new repository.

`rembg` supports local ONNX background-removal models, including `birefnet-general`. Select that model explicitly rather than relying on its changing default. Start with CPU inference so the workflow works without NVIDIA hardware. Downloading local weights is expected; processing should not send images to a remote background-removal service. [rembg documentation](https://github.com/danielgatis/rembg)

BiRefNet is the initial model to evaluate, not a promise that every garment will segment correctly. Test it on the owner's actual photos before considering another model. [BiRefNet project](https://github.com/ZhengPeng7/BiRefNet)

**Local processing hardware:** The owner's laptop runs macOS on an Apple M1 Pro with 16 GB of unified memory. Target native ARM64 Python 3.12 and the `rembg[cpu]` installation. ONNX Runtime provides Apple Silicon packages; check the installed macOS version when pinning dependencies, because current Mac wheels target macOS 14 or later. [ONNX Runtime packages](https://pypi.org/project/onnxruntime/#files)

Process photographs sequentially, exactly one image at a time, using one reused model session for the batch. Do not run concurrent segmentation processes or retain full-resolution images and masks for the entire batch in memory. Release each image's working buffers after its result is saved. The model's internal CPU threading may still use multiple cores; sequential processing refers to the number of images in flight.

CPU inference is the required starting configuration. Apple GPU/Neural Engine acceleration through Core ML is optional and needs explicit configuration and model compatibility checks; do not make it a prerequisite. [Core ML documentation](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)

Expect small sequential batches to be practical, but do not promise a runtime or memory figure without measuring it on this laptop. Start with three representative real photos, reuse the same model session, and report model initialization time separately from per-image processing time, plus peak process memory. Only proceed to the initial batch of up to 20 items after checking that the trial completes without memory-related failures. If real photos or this hardware are unavailable, document that the hardware trial remains unperformed.

Vercel Blob supports private storage. Use its documented authenticated read API from the server. For the local importer, use a storage token in the environment; on Vercel, use the connected store's documented authentication mechanism. [Blob SDK documentation](https://vercel.com/docs/vercel-blob/using-blob-sdk)

If creating authentication, restrict sign-in to the configured immutable GitHub user ID. Recheck that ID when authorizing application requests. Do not authorize everyone with a GitHub account or rely on a client-side check. Use Auth.js's supported OAuth and access restriction hooks for the installed version. [GitHub provider](https://authjs.dev/getting-started/providers/github), [restricting access](https://authjs.dev/guides/restricting-user-access)

## 4. Repository layout and ownership

The coordinator creates the scaffold and shared contract files before delegation. Repository-relative paths below are implementation targets:

```text
src/
  app/
    layout.tsx
    globals.css
    page.tsx
    sign-in/page.tsx
    items/[id]/page.tsx
    api/auth/[...nextauth]/route.ts
    api/items/route.ts
    api/items/[id]/route.ts
    api/items/[id]/image/route.ts
  components/wardrobe/
  lib/
    contracts/wardrobe.ts
    contracts/batch.ts
    contracts/persistence.ts
    auth.ts
    authorization.ts
    data/mongodb.ts
    data/wardrobe-repository.ts
    storage/blob.ts
scripts/
  prepare-batch.py
  review-sheet.py
  import-batch.ts
  setup-indexes.ts
  requirements.txt
docs/
  codex-photo-workflow.md
  implementation-spec.md
  verification.md
  setup.md
tests/
  pipeline/
  backend/
  integration/
wardrobe-data/                  # Git ignored
  incoming/<batch-id>/
  processed/<batch-id>/
.env.example
README.md
```

If existing conventions differ, the coordinator may adapt this layout once, document the mapping, and give all subagents the same paths.

| Owner | Files / responsibility |
| --- | --- |
| Coordinator | Shared contracts, package files and lockfiles, `.gitignore`, `.env.example`, app scaffold, integration checks, implementation specification, verification report, final README/setup documentation |
| Pipeline subagent | `prepare-batch.py`, `review-sheet.py`, `import-batch.ts`, `requirements.txt`, `docs/codex-photo-workflow.md`, pipeline tests |
| Backend subagent | Authentication and authorization modules, database and storage modules, API routes, `setup-indexes.ts`, backend tests |
| UI subagent | Wardrobe components, catalogue and item pages, sign-in page, styles within the agreed scaffold |

Only the coordinator edits shared contracts or Node dependencies. The pipeline subagent owns the Python requirements file but submits its proposed pinned versions to the coordinator before installation. Subagents report other necessary dependency changes to the coordinator. In a shared checkout, use the disjoint ownership above and preserve other agents' changes. If isolated worktrees are used, integrate their changes before verification.

## 5. Shared clothing and API contracts

Create `src/lib/contracts/wardrobe.ts` with the following contract and matching strict Zod schemas. The API boundary uses JSON with ISO 8601 timestamps. The client never receives storage credentials, Blob URLs, or storage pathnames.

```ts
export const CLOTHING_TYPES = [
  "outer", "shirt", "tshirt", "pants", "shorts", "shoes",
] as const;

export type ClothingType = (typeof CLOTHING_TYPES)[number];

export const CLOTHING_LABELS: Record<ClothingType, string> = {
  outer: "Jacket / outer",
  shirt: "Shirt",
  tshirt: "T-shirt",
  pants: "Pants",
  shorts: "Shorts",
  shoes: "Shoes",
};

export type ImageVariant = "cutout" | "original";

export interface ItemDTO {
  id: string;                    // UUID
  type: ClothingType;
  images: {
    cutout: string;              // same-origin authenticated image endpoint
    original: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ListItemsResponse {
  items: ItemDTO[];
  total: number;                 // number matching the current filter
  counts: Record<ClothingType, number>; // all active items, before filtering
}

export interface GetItemResponse { item: ItemDTO }
export interface ListItemsPageResponse extends ListItemsResponse {
  nextCursor: string | null;
}
export interface UpdateItemRequest { type: ClothingType }
export interface UpdateItemResponse { item: ItemDTO }

export type ErrorCode =
  | "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_REQUEST"
  | "NOT_FOUND" | "SERVICE_UNAVAILABLE" | "INTERNAL_ERROR";

export interface ErrorResponse {
  error: { code: ErrorCode; message: string };
}
```

Classification definitions:

- `outer`: jackets, coats, and recognizable outer layers.
- `shirt`: woven or button-front shirts, whether short- or long-sleeved.
- `tshirt`: recognizable T-shirts, whether short- or long-sleeved.
- `pants`: long trousers, including jeans.
- `shorts`: short trousers.
- `shoes`: shoes, trainers, boots, and sandals; a pair is one item.

For a garment that does not clearly fit these definitions, retain `type: null` in the local batch and flag it for the owner. Do not invent a seventh type or confidently force an ambiguous garment into a category. Imported catalogue items must have one of the six valid types.

## 6. Database and shared server interfaces

Use one `wardrobe_items` collection. Keep images in Blob storage, not MongoDB. The coordinator creates the following interfaces in `src/lib/contracts/persistence.ts` before delegation, importing `ClothingType` from the wardrobe contract:

```ts
export interface StoredImage {
  pathname: string;
  contentType: "image/jpeg" | "image/png";
}

export interface WardrobeDocument {
  _id: string;                   // UUID, exposed as ItemDTO.id
  sourceSha256: string;          // SHA-256 of unchanged source-file bytes
  type: ClothingType;
  images: { original: StoredImage; cutout: StoredImage };
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type ItemCounts = Record<ClothingType, number>;

export interface WardrobeRepository {
  listActive(type?: ClothingType): Promise<WardrobeDocument[]>;
  countActiveByType(): Promise<ItemCounts>;
  getActiveById(id: string): Promise<WardrobeDocument | null>;
  findBySourceHash(hash: string): Promise<WardrobeDocument | null>;
  insertIfAbsent(document: WardrobeDocument): Promise<{
    inserted: boolean;
    document: WardrobeDocument;
  }>;
  updateType(id: string, type: ClothingType): Promise<WardrobeDocument | null>;
  softDelete(id: string): Promise<boolean>; // true if ID exists, even already hidden
}

export interface ImageStore {
  putPrivate(pathname: string, bytes: Uint8Array,
    contentType: StoredImage["contentType"]): Promise<StoredImage>;
  readPrivate(image: StoredImage): Promise<{
    body: ReadableStream<Uint8Array>;
    contentType: string;
  } | null>;
}
```

Backend exports `getWardrobeRepository()` from `wardrobe-repository.ts` and `getImageStore()` from `blob.ts`. These are lazy factories. The importer uses them directly and does not send privileged writes through a public website endpoint. Return implementations of the interfaces above; handle the installed Blob SDK's return types inside the adapter. `putPrivate` creates immutable files or reuses existing files with identical byte digests; it throws on a content mismatch. `readPrivate` handles a missing stored object by returning null.

To make the UI/backend boundary explicit, backend also exports `toItemDTO(document: WardrobeDocument): ItemDTO` from `wardrobe-repository.ts` and `requireOwner(): Promise<void>` from `authorization.ts`. `requireOwner` returns only for the authorized owner and otherwise throws an exported `AuthorizationError` carrying `status: 401 | 403` and the matching error code. API routes map this error to JSON; server-rendered pages redirect anonymous users to sign-in and render an access-denied state for a forbidden session. UI server reads call this guard before the repository. The importer uses the repository factories directly without importing session authorization.

Create a unique index on `sourceSha256`, including hidden items. This deduplicates exact source files only; it does not claim to detect two different photographs of the same garment. Create an index supporting active-item sorting by `createdAt` and `_id`. Return newest items first, with `_id` as a deterministic tiebreaker.

Do not connect to MongoDB or require secrets merely by importing a module during build. Reuse connections across requests. Modules shared with `tsx` scripts must not import Next.js-only runtime helpers or a `server-only` package that prevents standalone Node execution. Keep them out of all client component imports.

## 7. API endpoints

Every catalogue endpoint requires the single authorized session, including image reads. Framework-managed auth routes retain Auth.js's own authentication behavior.

| Method and endpoint | Input | Success |
| --- | --- | --- |
| `GET /api/items` | Optional `?type=outer` etc. Omitted means All. Add `limit` (1–48, default 24) or `cursor` to request a page. | `200 ListItemsResponse`, or `ListItemsPageResponse` when pagination is requested |
| `GET /api/items/:id` | Valid UUID | `200 GetItemResponse` |
| `PATCH /api/items/:id` | JSON containing exactly `{ "type": "shirt" }` | `200 UpdateItemResponse` |
| `DELETE /api/items/:id` | Valid UUID | `204`, no response body |
| `GET /api/items/:id/image?variant=cutout` | `variant=cutout` or `variant=original` | `200`, authenticated image bytes |
| `GET/POST /api/auth/[...nextauth]` | Managed by Auth.js | Managed by Auth.js |

Rules:

- Reject invalid UUIDs, unknown types, unsupported variants, and extra PATCH fields with `400 INVALID_REQUEST`.
- Use `401 UNAUTHORIZED` for no session and `403 FORBIDDEN` for a session not matching the owner.
- Missing or hidden items return `404 NOT_FOUND`, including image reads. Repeated DELETE on a hidden item returns 204; a never-existing ID returns 404.
- Check same-origin requests for PATCH and DELETE in addition to session authorization; a missing or mismatched Origin is `403 FORBIDDEN`. Use the request's actual origin or a configured trusted origin according to the deployment setup; do not trust an arbitrary client-supplied origin.
- Resolve an image's storage pathname from the database record. Do not accept a Blob pathname or arbitrary remote URL from the browser.
- Generate DTO image URLs as `/api/items/${id}/image?variant=cutout` and `/api/items/${id}/image?variant=original`.
- Calls without `limit` or `cursor` return all matching items for existing API clients. The catalogue uses pages of 24, ordered by clothing type in `CLOTHING_TYPES` order, then newest `createdAt` and descending ID within each type. Cursors encode the last item and selected filter; reject malformed cursors or a cursor from a different filter with `400 INVALID_REQUEST`. `total` always counts all matching active items, and `nextCursor: null` ends pagination. Later pages retain the same owner authorization and private cache headers.
- Render the initial catalogue page on the server. Automatically load subsequent pages with an `IntersectionObserver` using an 800px prefetch margin, deduplicate appended IDs, and cancel requests when the grid unmounts or filters change. Keep a manual Load more button; stop automatic loading after an error and offer Try again without clearing existing cards.
- Use private, non-shared cache behavior for catalogue JSON and images; start with `Cache-Control: private, no-store`.
- Missing services at request time return a clear failure, not an empty successful catalogue. Do not expose database URIs, provider errors, or tokens in responses.
- Route handlers must be compatible with the installed Next.js version, including dynamic route parameter handling.

## 8. Local batch manifest

Create `src/lib/contracts/batch.ts` with matching strict runtime validation:

```ts
export type ReviewStatus = "pending" | "approved" | "rejected";

export interface BatchEntry {
  sourcePath: string;            // relative to incoming/<batchId>/
  sourceSha256: string;
  type: ClothingType | null;
  cutoutPath: string | null;     // relative to processed/<batchId>/
  cutoutSha256: string | null;   // digest of the output file reviewed by the owner
  model: "birefnet-general";
  warnings: string[];
  reviewStatus: ReviewStatus;
}

export interface BatchManifest {
  schemaVersion: 1;
  batchId: string;
  entries: BatchEntry[];
}

export interface ImportReport {
  batchId: string;
  imported: { sourceSha256: string; itemId: string }[];
  skipped: {
    sourceSha256: string;
    reason: "not_approved" | "already_exists" | "previously_removed";
    itemId?: string;
  }[];
  failed: { sourceSha256: string; message: string }[];
}
```

The manifest is stored at `wardrobe-data/processed/<batchId>/manifest.json`. Use a batch ID containing only letters, numbers, underscores, and hyphens. Resolve and check real paths: an entry must stay inside its expected batch directory, including when symlinks are present. Never execute manifest contents as code or shell commands.

Initially order entries by source path, and append newly discovered entries deterministically without reordering existing entries. Use the manifest's one-based entry index as the review-sheet number and include the source hash in its review mapping. Exact duplicates inside one batch share one manifest entry; report all extra source paths without creating extra items. Keep entries for missing source files visible with a warning so a numbered review is never silently reassigned. A changed source file has a new hash and must become a new pending entry.

Git-ignore `wardrobe-data/`, Python virtual environments, local model caches, reports containing personal file names, and real environment files. Commit `.env.example` and a small synthetic fixture only.

## 9. Local preparation and segmentation

Provide these exact command interfaces, adapted only for the repository's package manager:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements.txt
.venv/bin/python scripts/prepare-batch.py --batch <batch-id>
.venv/bin/python scripts/prepare-batch.py --batch <batch-id> --limit 3 --benchmark
.venv/bin/python scripts/prepare-batch.py --batch <batch-id> --reprocess <source-sha256>
.venv/bin/python scripts/review-sheet.py --batch <batch-id>
npm run wardrobe:import -- --batch <batch-id> --dry-run
npm run wardrobe:import -- --batch <batch-id>
npm run wardrobe:indexes
```

`prepare-batch.py` behavior:

1. Discover JPEG/JPG and PNG files in the batch input folder. Report unsupported files explicitly.
2. Compute SHA-256 on unchanged original bytes. Never overwrite originals.
3. Use Pillow to apply EXIF orientation to the working image before segmentation. On the owner's M1 Pro with 16 GB of memory, process exactly one image at a time using one reused model session. Save each result and release its working image/mask buffers before processing the next image; do not introduce a pool of segmentation workers.
4. Ask the local model for a foreground mask. Apply that mask to the working photo. Do not generate replacement garment pixels, change colour, repair patterns, or redraw missing areas.
5. Find the bounds of nontrivial foreground alpha, add approximately 5% padding, and fit the item proportionally within a 1024 × 1024 transparent PNG. Center it; do not stretch or cut off sleeves, straps, or shoes.
6. Retain separate foreground regions when they belong to one item, such as a pair of shoes. Do not blindly discard all but the largest component.
7. Flag empty, near-empty, or near-full masks for review. These checks help catch failures but do not replace visual inspection. Thin straps, fine fabrics, shadows, and similar foreground/background colours may still need review.
8. Write a cutout using a filename derived from the source hash, compute its `cutoutSha256`, and create/update the manifest without fabricating a clothing type. New entries start with `type: null` and `reviewStatus: "pending"`. Store null cutout path/hash when preparation has not succeeded.
9. Preserve existing types and reviewed entries on a normal rerun. Support a repeatable `--reprocess <source-sha256>` option for explicit regeneration of particular entries. Reject hashes outside that batch. When regenerating a cutout, retain its type but set the entry back to pending and explain why approval was reset.
10. Write files atomically. A failed entry must not leave a misleading successful manifest entry. Print a compact per-batch summary.

Support `--limit <positive-integer>` to process only that many eligible new entries while discovering all inputs. Unprocessed entries remain pending with null cutout path/hash and can be completed by a subsequent normal run. Combining `--limit` with `--reprocess` is invalid in v1. `--benchmark` writes a local `benchmark.json` reporting architecture, Python/package/model versions, model-session initialization duration, processing duration per attempted image, and peak process memory with explicit units. State whether initialization included a first-time model download. This report contains measured results, not estimated speed claims.

`review-sheet.py` reads the validated manifest and produces numbered, paginated PNG sheets with the oriented original and cutout side by side. Show cutouts on white, retain aspect ratios, and label each entry with its number, type or Unclassified, review status, and warnings. Use at most four entries per sheet and downscaled display copies so the sheet generator also fits the owner's laptop. Include unprocessed or failed entries with a clear placeholder, never a fabricated image. Write `review-001.png`, subsequent pages as needed, and `review-index.json` mapping each number to its source hash and cutout digest. All outputs stay inside the ignored processed batch folder. Regenerate sheets after classification or reprocessing so labels and approval correspond to the current manifest. Codex still opens individual full images when needed for inspection.

Transparent PNG is the stored result. The website supplies the white background. This satisfies both white-background browsing and preservation of transparency without storing two redundant thumbnails.

Codex supplies the semantic classification and visual review after preparation by actually inspecting source images and cutouts. The script does not call GPT. If segmentation fails, retain the source and mark the entry pending or rejected. Do not present a rectangular crop as a successful cutout or quietly switch to generative image editing.

The user is explicitly requesting mask-based removal of the background while preserving the item. Use local segmentation and ordinary image transformations for this workflow.

## 10. Local importer

`import-batch.ts` must:

- Explicitly load `.env.local`; the standalone script cannot rely on Next.js to load it.
- Validate the entire manifest structure before making writes. Validate each approved entry's paths, actual image contents, allowed formats, source hash, and cutout hash; invalid approved entries are reported as failed and never uploaded. Pending or rejected entries may legitimately lack output files and must not prevent independent approved entries from importing.
- Reject an approved entry without a valid type, existing cutout, and nonempty RGBA image. Do not silently import incomplete records.
- Make `--dry-run` perform the same validation and existing-record checks as a real import, then report intended inserts/skips without uploading or changing MongoDB. Report proposed inserts separately as a plan; do not populate `ImportReport.imported` with items that have not been inserted.
- Import only approved entries. Pending and rejected entries are reported as not approved.
- Find existing source hashes, including hidden items. Skip them. Do not reset a manually corrected type or resurrect a removed item on rerun.
- Upload the unchanged source photo and transparent cutout with private access, using content-addressed pathnames: `wardrobe/<sourceSha256>/original.jpg` (or `.png`, according to decoded format) and `wardrobe/<sourceSha256>/cutout-<cutoutSha256>.png`.
- Treat these blobs as immutable. On retry, reuse an existing matching blob through the storage adapter's documented behavior. Never overwrite existing files with different content. A newly reviewed cutout after a partial import failure has a different pathname, allowing recovery without overwriting the old cutout. An already inserted source remains skipped; replacing an imported item's images is outside v1 scope.
- Insert the database document only after both images are stored. The unique index is the final duplicate guard. Handle a concurrent insert as an existing record rather than a duplicate item.
- Continue with independent entries after a per-item failure and produce `import-report.json`. Exit nonzero if any import failed. A retry must safely resume without duplicating successful items.
- Preserve already uploaded files after a partial failure so a retry can reuse them. Report any unreferenced files; do not perform broad storage cleanup.

The normal app has no POST item-creation endpoint. Local ingestion is the intentionally simple privileged write path.

## 11. Website behavior

Use an English interface with the labels in the shared contract. The appearance should resemble a clean personal wardrobe gallery:

- White or light neutral page, generous but practical spacing, minimal decoration.
- A header with “Wardrobe,” the active total, and a small sign-out control.
- Filters for All and the six types. Store the selected type in the URL so refresh and back navigation work.
- Two columns on narrow phones, increasing to three, four, or five as space permits.
- Square white image areas with `object-fit: contain`, never cover. A small clothing-type label is sufficient below each image.
- Selecting an item opens its detail page. Show the larger cutout, a simple Original photo toggle, and the type selector. Do not put technical hashes or processing information in the product UI.
- Updating the type persists via PATCH and refreshes affected data. Display a clear saving state and a recoverable error; do not show success before the request succeeds.
- Remove from catalogue uses the DELETE endpoint after a small confirmation. Explain that it hides the item. Return to the catalogue and update counts.
- Handle no items, no matches, loading, failed reads, and failed mutations explicitly. A fetch error must not look like an empty wardrobe.
- Use real links, labelled controls, keyboard access, visible focus, and readable contrast. Avoid hover-only controls.

Prefer Server Components for initial authenticated data. Use Client Components only for controls that need interaction. Reuse the repository/service layer for server reads rather than making unnecessary HTTP calls back into the same app. DTOs and authorization behavior must remain identical to the public API contract.

Use `next/image` where appropriate. Images are authenticated same-origin routes; the image optimizer's server fetch may not carry the browser session. Use `unoptimized` for these protected images and supply stable dimensions and appropriate loading behavior. Confirm in the browser that every image remains protected and loads for the signed-in owner.

No fake wardrobe items appear in normal operation. Test fixtures belong in tests or an explicitly labelled development fixture path.

## 12. Environment and setup documentation

Create `.env.example` containing placeholders and brief explanations for:

```dotenv
MONGODB_URI=
MONGODB_DB=wardrobe
BLOB_READ_WRITE_TOKEN=
BLOB_STORE_ID=
AUTH_SECRET=
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
AUTH_ALLOWED_GITHUB_ID=
```

Adapt auth variables if reusing existing authentication. Explain which Blob variables are needed for local import versus a connected Vercel deployment. Leave Vercel-managed OIDC tokens to the platform and SDK; do not copy them into committed examples. Do not use `NEXT_PUBLIC_` for secrets.

Document:

1. Installing dependencies and starting the app.
2. Creating or reusing MongoDB Atlas and a private Blob store.
3. Creating the one-user OAuth setup, obtaining the immutable user ID, and setting local/production callback URLs.
4. Creating database indexes.
5. Exporting phone photos into a batch folder.
6. Installing native ARM64 Python dependencies on the owner's M1 Pro Mac, checking macOS/ONNX Runtime compatibility, and downloading the initial local model. Explain the sequential batch behavior and three-photo timing/memory trial.
7. Running preparation, generating numbered review sheets, Codex classification/review, dry-run import, and real import. Explain that changing a reviewed cutout invalidates its approval and hash, so it must be reprocessed and reviewed again.
8. Deploying the app through the owner's Vercel workflow.
9. Recovering from failed processing and rerunning a partial import.

Build all code and configuration templates before requesting missing credentials. Reuse service access already supplied through the session or project environment. If credentials or photos are unavailable, finish independent implementation and fixture checks, then identify the exact remaining live gates and the smallest owner action needed. A live gate awaiting external input remains pending; it does not become a passing test. Do not fabricate a successful deployment or real-photo trial. Do not create paid resources or publish personal images without authorization. When deployment is requested and authorized, complete the production smoke flow in section 14; otherwise deliver production-ready code and deployment instructions.

## 13. Prompts for the three subagents

Spawn these assignments with the model settings in section 1. The coordinator must supply each subagent this specification, the shared contract files, and its owned paths. Each agent reads those files before editing and returns implementation plus its focused checks. The following assignments can run concurrently after scaffolding.

### Subagent A — local photo pipeline

> Implement the local preparation and import workflow in sections 8–10. You own the preparation, numbered review-sheet, and import scripts, Python dependency file, workflow documentation, and pipeline tests. Read the shared TypeScript contracts before writing code. Use local `rembg` with the explicitly selected `birefnet-general` model, preserve source photos, and create transparent square PNG cutouts. Target the owner's macOS M1 Pro with 16 GB of memory: native ARM64 Python, CPU inference, exactly one image at a time, one reused model session, and released per-image buffers. Implement the three-photo timing and peak-memory trial described in section 3, including the `--limit` and `--benchmark` options; avoid concurrent segmentation workers. Classification is supplied through interactive Codex image inspection, not a paid API. Implement pending/approved/rejected review states, source/cutout digest validation, safe path handling, idempotent reruns, dry-run import, and an import report. Use the backend's `getWardrobeRepository()` and `getImageStore()` interfaces; do not implement a separate persistence stack. If those modules are still being built, code against their contract and report the dependency. Do not modify shared contracts, package files, or backend modules. Ask the coordinator for dependency changes. Your completion message must list changed files, exact commands, checks actually run, and remaining dependencies. Do not claim segmentation quality without inspecting real output.

### Subagent B — backend, storage, and authorization

> Implement sections 6–7 and the backend parts of sections 3 and 12. You own authentication/authorization, database repository, private Blob adapter, API routes, index setup script, and backend tests. Export the exact shared server interfaces, `toItemDTO`, `requireOwner`, and `AuthorizationError` as specified. Protect every catalogue and image request with the one-owner check. Validate inputs and mutations, stream private image bytes, and keep storage references out of DTOs. Make database and storage access lazy so builds do not require live credentials. Keep shared persistence modules runnable in the standalone importer. Implement source-hash uniqueness and soft removal. Do not add public creation/classification/upload endpoints. Do not modify shared contracts, package files, UI files, or pipeline scripts. Your completion message must list changed files, exported functions, environment requirements, checks actually run, and remaining dependencies.

### Subagent C — personal wardrobe interface

> Implement section 11 using the shared DTOs, clothing labels, and existing scaffold. You own wardrobe components, the catalogue page, item detail page, sign-in page, and agreed styles. Use section 6's explicit `requireOwner`, repository, and `toItemDTO` exports for guarded server reads. Build a responsive grid with white square image areas that contain the whole garment, type filters with counts, type correction, original-photo viewing, and removal confirmation. Implement empty, loading, and error states. Use authenticated same-origin image endpoints and verify they load correctly without exposing private Blob URLs. Keep the only descriptive item field as clothing type. Do not add unrelated features, invented categories, or production mock data. Do not modify contracts, dependencies, backend, or pipeline files. Your completion message must list changed files, the interface behavior implemented, checks actually run, and remaining dependencies.

## 14. Coordinator workflow and verification

Work in this order:

1. Inspect repository instructions and existing app conventions. Check the relevant official SDK documentation.
2. Scaffold the app and freeze shared contracts. Create any empty module scaffolds needed so agents can work against agreed imports.
3. Explicitly spawn the three Luna agents using section 1's delegation contract. Include ownership, contracts, and definition of done in every handoff. Keep coordination messages concise and track reported dependencies.
4. Review agents' changes for contract drift and fix integration issues. Do not treat individual agent completion as whole-app completion.
5. Run type checking, linting if configured, and a production build. Fix failures.
6. Implement and run the focused checks and reproducible scenarios below. Avoid tests that merely duplicate implementation.
7. Start the development server and verify the complete flow in a browser, tracing UI actions through the API and persistence. Use the applicable browser verification skills if available. Fix failures and rerun affected scenarios.
8. With the owner's laptop and real photos available, first run the three-photo timing and memory trial on the M1 Pro with 16 GB of memory. Then, with services available, process an initial batch of up to 20 items sequentially and verify a live import. Otherwise label the remaining live checks clearly.
9. Finish with working code, setup documentation, the photo-processing prompt, and `docs/verification.md` recording completion gates and evidence. Summarize its actual status to the owner.

### Verification commands and isolation

Expose documented scripts for `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `wardrobe:indexes`, and `wardrobe:import`. For a new app, `test` runs focused TypeScript tests and Python transformation tests, and `test:e2e` runs the browser scenarios against a dedicated test instance. Explain the exact prerequisites and how to establish a real owner session for E2E tests. If they are missing, report a pending gate and a clear actionable error rather than a green no-op test. Adapt existing script names only if the README gives an exact equivalent command.

Run repeatable tests with nonpersonal fixtures and a separate disposable MongoDB database, such as `wardrobe_e2e_<run-id>`. Use only Blob objects created and tracked by that test run. Record baseline counts and clean up only the database and objects created by the test. Never wipe the owner's normal catalogue, remove their images, or run broad cleanup against shared storage.

For a fresh checkout without service credentials, fixture tests may use explicitly injected repository/storage test doubles. Python fixture tests may inject deterministic masks/sessions into the same preparation functions so transformation and manifest checks do not depend on model predictions on synthetic images. Carry those generated fixture files through importer checks. This proves only those exercised code paths. It does not satisfy the live MongoDB/Blob or real-model/real-photo gates. Keep doubles and failure injection in the test runner; normal application requests always use the real adapters.

For signed-in browser verification, use the real OAuth flow or an existing owner session. A saved browser session for tests must be local and Git ignored. If the owner must interact with sign-in, request that narrow step when the app is ready and continue independent checks meanwhile. Do not create a public auth bypass, fake a live session, or weaken production authorization to make tests pass. Test non-owner authorization in server integration tests if a second real account is unavailable.

### Flow A — photo folder to private catalogue

Use a controlled three-item fixture batch for reproducible tests. For the real-photo trial, the owner determines which reviewed entries to approve; do not change their decisions just to match fixture counts.

1. Start with an empty disposable catalogue, create indexes, and place three valid JPEG/PNG fixture photos in the input folder. Include an EXIF-rotated original and an item with two foreground regions in transformation tests. Real segmentation quality still requires garment photographs.
2. Run preparation with `--limit 3 --benchmark`. Expect three manifest entries, preserved original hashes, square 1024 × 1024 RGBA cutouts for successful entries, measured benchmark output, null types, and pending review. Confirm a single session and sequential processing from the implementation and observed process behavior.
3. Inspect outputs, assign known fixture types, and run the review-sheet command. Expect source/cutout pairs, stable entry numbers, current labels, and a mapping to matching source/cutout hashes. In the real-photo trial, Codex must inspect actual images before classification and approval is the owner's decision.
4. Mark exactly two valid fixture entries approved and retain the third as pending. Run dry-run import. Expect two planned inserts, one not-approved skip, zero uploaded objects, and zero inserted documents.
5. Run real import into the disposable database and private store. Expect two inserted documents, both image references for each inserted item, one not-approved skip, and a report agreeing with database state.
6. Sign in as the owner and open All on phone and desktop viewports. Expect two visible items, the expected global type counts, white image backgrounds, intact garment proportions, and no horizontal overflow or console errors. The API, database, and displayed counts must agree.
7. Open an item, toggle between cutout and original, and inspect the network responses. Expect authenticated 200 image responses with correct media types; original bytes match the source hash and cutout bytes match the reviewed cutout hash. DTOs expose same-origin image endpoints.
8. In a separate anonymous browser context, request the catalogue JSON, item detail JSON, and both image endpoints. Expect 401 and no image bytes. Anonymous page navigation should reach sign-in. Test a non-owner session produces 403 through the server integration harness.
9. Approve the third fixture entry and rerun import. Expect only one new item and an All count of three. Rerun again and expect zero new documents and zero unnecessary uploads.

### Flow B — category correction, filtering, and persistence

1. Record the current type counts, open an item, and change it to a different allowed type through the UI.
2. Expect a successful PATCH, a persisted database type, a visible saved state, the old count reduced by one, and the new count increased by one.
3. Refresh, open the new type filter, and use browser back navigation. Expect the corrected type to persist, the filter URL to match the displayed results, and counts to remain correct.
4. Rerun the item's original import with its old manifest classification. Expect it to be skipped and the owner's corrected database type to remain unchanged.
5. Submit an invalid type, extra PATCH field, malformed ID, and a cross-origin mutation through tests. Expect the specified failure response and no state change. UI mutation failures must show a recoverable error and keep the previous saved state.

### Flow C — removal and subsequent imports

1. Remove one fixture item through the UI and confirmation. Expect a 204 response, one hidden database record, a decremented visible total, and updated filters/counts.
2. Refresh and directly request its detail and both image endpoints as the owner. Expect 404, while its stored files and record still exist.
3. Repeat DELETE and expect 204. Rerun its import and expect `previously_removed`, with no restoration or replacement item.

### Flow D — failed processing and partial import recovery

Exercise importer failures using test-only injected storage/repository adapters; exercise real adapter reads/writes separately when service access is available.

1. Add an unsupported photo format and a source whose test mask is empty. Expect explicit diagnostics, no falsely approved entry, and no silent substitution of a rectangular crop.
2. Make one valid fixture import succeed and inject a failure after another fixture's image upload but before its document insert. Expect a nonzero exit/report failure, the successful item preserved, no incomplete database document, and identifiable uploaded objects for the failed entry.
3. Remove the injected failure and retry. Expect the successful item skipped, matching uploaded blobs reused, the failed entry inserted once, and final record counts matching unique approved hashes.
4. Reprocess a pending entry explicitly. Expect its approval reset to pending and its cutout digest refreshed. Regenerate the review sheets. After review/approval, a changed cutout uses a new content-addressed pathname and cannot collide with a previous partial upload.
5. Modify an approved cutout file without updating its manifest through preparation/review. Expect a digest mismatch and no upload for that entry. Test a path or symlink escaping its batch folder and expect rejection.

### Flow E — service errors and optional production smoke check

- Verify missing or unavailable MongoDB/Blob produces clear request failures and usable UI error states. A Blob object missing for an existing item returns an image 404; an unavailable storage service returns an appropriate service error. Distinguish these states from an empty catalogue. Restore the service and confirm recovery.
- Verify a fresh production build succeeds without eagerly connecting to services. Confirm that credentials and private image references are absent from browser bundles and API payloads.
- If deployment is requested and authorized, configure production environment values and OAuth callback URLs, deploy, and repeat owner sign-in, private image viewing, filter navigation, and anonymous-denial checks on the deployed URL. Verify a category change persists there using an owner-approved test item, then restore its original type. Capture the final URL and results. A local pass alone does not satisfy the deployed smoke gate.

Required meaningful checks:

- Invalid type and malformed PATCH payload fail validation.
- An anonymous request cannot read the catalogue or either image variant, and a non-owner cannot access it.
- Removed items disappear from the grid and image endpoint.
- Counts and selected filters agree with the stored active items.
- A category change survives refresh and is preserved by rerunning the original import.
- A batch rerun creates no duplicate records and does not restore removed items.
- Dry-run import performs no writes.
- A partial import failure can be retried safely.
- Traversing out of a batch folder is rejected.
- A synthetic mask-processing fixture preserves aspect ratio, handles EXIF orientation and multiple foreground regions, and produces nonempty transparent PNG output. This checks transformations; it does not establish model quality.
- On actual garment photos, visually compare source and cutout for missing sleeves, straps, logos, retained background, and incorrect colours. Flag failures for review.
- The signed-in owner can browse and change a type on a phone-sized viewport without console errors.

### Completion gates and handoff

The scenarios above are the source of truth; the checklist summarizes their risks and does not require duplicate test implementations.

Record each gate in `docs/verification.md` as `passed`, `failed`, `pending-input`, or `not-requested` (the last applies only to deployment). Include the commands run, which environment/adapters were used, actual results, and paths to useful screenshots/reports. Keep personal photos, screenshots, session state, and detailed batch reports in ignored local folders; the committed report should contain only non-sensitive summaries and file references.

| Gate | Evidence required |
| --- | --- |
| Implementation and integration | All specified files/scripts work together; no placeholder auth, storage, API, or UI paths remain |
| Build and focused tests | Actual typecheck, lint, test, and production-build results |
| Reproducible workflow | Flow A–D fixture/integration results, with the use of doubles stated explicitly |
| Live services and browser | Real MongoDB + private Blob import and authorized/anonymous browser checks; phone and desktop screenshots |
| Real-photo quality and hardware | Three-photo benchmark on the M1 Pro, visual review findings, and owner-approved import; initial up-to-20-item trial when supplied |
| Deployment | Flow E production smoke results, or `not-requested` |

Fix failed gates before handoff where work can proceed. For missing external inputs, finish all independent work and list the exact pending step, input needed, and command that resumes it. After the input arrives, continue from that step. Do not declare the complete live workflow verified while its live services, owner-session, or real-photo gates are pending.

Final response: state what was built, the actual subagent models used or their verification limitation, checks that passed, pending gates, how to start the app, how to process the first batch, and deployment status/URL. Link the setup and verification documents. Only report checks that actually ran. Do not expand product scope to address unrelated ideas discovered during implementation.

## 15. Reusable Codex photo-processing prompt

Write the following prompt into `docs/codex-photo-workflow.md`, adjusting commands only to match the final implementation. This prompt is for the owner to use after the app is built:

> Process my wardrobe photo batch `<batch-id>` using this repository's documented workflow. I am using my signed-in Codex subscription for classification and visual review. Do not call a paid AI API.
>
> 1. Read the workflow documentation and existing manifest. Inspect the batch folder and report unsupported photo formats. Preserve all original files.
> 2. Run local preparation with the project's explicitly configured segmentation model. My laptop is a macOS M1 Pro with 16 GB of memory: use native ARM64 Python and CPU inference, process exactly one image at a time, reuse one model session, and release per-image buffers. On the first run on this laptop, complete the documented three-photo timing/memory trial before the full batch. If its setup is missing, follow the documented setup and report any actual blocker.
> 3. Open and visually inspect each new source photo and its cutout using the available image-viewing tools. Process a manageable number at a time so every file is inspected. Do not classify from filenames or claim to have seen an image that you could not open.
> 4. Assign exactly one type: `outer`, `shirt`, `tshirt`, `pants`, `shorts`, or `shoes`, and write it to the manifest. A pair of shoes counts as one item. Leave uncertain or unsupported garments unclassified and ask me to resolve them in the batch review.
> 5. Check that each cutout preserves the item's visible shape, colour, design, and separate parts. Pay attention to sleeves, straps, fine fabric, logos, and white areas. Record segmentation failures in the manifest. Do not generate new garment pixels or conceal an unsuccessful mask.
> 6. Preserve previously reviewed entries and existing classifications. Keep new entries pending until I approve them. Run the documented review-sheet command after writing classifications. Show the private local sheets with source and cutout side by side, numbered consistently with the manifest and mapped to matching hashes. Include type labels and compact warnings so I can approve the batch or identify exceptions.
> 7. Summarize how many items are ready, uncertain, or failed, with a reviewable result. After I approve specific entries or the whole ready batch, mark only those entries approved. If my request already includes approval for those exact reviewed entries, use it without asking again.
> 8. When I ask to import, first run the dry-run import and inspect its report, then perform the import if validation succeeds. Import only approved entries. Preserve my catalogue edits, skip exact duplicates, and keep removed items hidden.
> 9. Report imported, skipped, and failed items and show the catalogue URL if configured. Do not mark failed entries as imported. Do not add other descriptive fields or categories.

Example owner requests:

```text
Process wardrobe batch 2026-10-01 and show me the review sheet.

Approve the ready items except review-sheet numbers 3 and 8, then import them.

I corrected the input for item 8. Reprocess that entry and show it for review.
```

The review sheet is a local inspection aid and is not part of the website. If image-viewing tools are unavailable, prepare files and explain that visual classification/review remains pending. Never replace visual review with a guessed claim of success.
