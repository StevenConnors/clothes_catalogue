# Codex photo workflow

Process my wardrobe photo batch `<batch-id>` using this repository's documented workflow. I am using my signed-in Codex subscription for classification and visual review. Do not call a paid AI API.

1. Read this workflow documentation and the existing manifest. Inspect the batch folder and report unsupported photo formats. Preserve all original files.
2. Run local preparation with the explicitly configured segmentation model. Use native ARM64 Python on the M1 Pro, CPU inference, one image at a time, and one reused model session. The first trial on this laptop uses three representative photos and reports initialization time, per-image time, and peak memory. If setup is missing, follow `docs/setup.md` and report any actual blocker.
3. Open and visually inspect each new source photo and cutout. Process a manageable number at a time. Do not classify from filenames or claim to have seen an image you could not open.
4. Assign exactly one type: `outer`, `shirt`, `tshirt`, `pants`, `shorts`, or `shoes`; write it to the manifest. A pair of shoes is one item. Leave uncertain garments unclassified and ask me to resolve them.
5. Check that each cutout preserves the item's shape, colour, design, and separate parts. Pay attention to sleeves, straps, fine fabric, logos, and white areas. Record segmentation failures. Do not generate garment pixels or hide an unsuccessful mask.
6. Preserve previously reviewed entries and classifications. Keep new entries pending until I approve them. Run the review-sheet command after classification. Show numbered local sheets with source and cutout side by side, matching hashes, type labels, and warnings.
7. Summarize ready, uncertain, and failed entries. After I approve specific entries or the whole ready batch, mark only those approved. If my request already includes approval for those exact reviewed entries, use it.
8. When I ask to import, run and inspect dry-run first, then perform the import if validation succeeds. Import only approved entries. Preserve catalogue edits, skip exact duplicates, and keep removed items hidden.
9. Report imported, skipped, and failed items and show the catalogue URL if configured. Do not mark failed entries as imported. Do not add descriptive fields or categories.

Commands (activate `.venv` or use its interpreter explicitly):

```sh
.venv/bin/python scripts/prepare-batch.py --batch <batch-id>
.venv/bin/python scripts/prepare-batch.py --batch <batch-id> --limit 3 --benchmark
.venv/bin/python scripts/prepare-batch.py --batch <batch-id> --reprocess <source-sha256>
.venv/bin/python scripts/review-sheet.py --batch <batch-id>
npm run wardrobe:import -- --batch <batch-id> --dry-run
npm run wardrobe:import -- --batch <batch-id>
```

Example requests:

```text
Process wardrobe batch 2026-10-01 and show me the review sheet.
Approve the ready items except review-sheet numbers 3 and 8, then import them.
I corrected the input for item 8. Reprocess it and show it for review.
```

If image-viewing tools are unavailable, prepare files and explain that classification and visual review remain pending. Never substitute guessed success for visual review.
