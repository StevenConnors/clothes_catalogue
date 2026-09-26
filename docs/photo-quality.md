# Photo quality and segmentation

The six first-batch photos were visually checked against their processed PNGs. BiRefNet preserved the garments but also selected hanger and exercise-rack parts as foreground. These remnants are recorded as warnings. The owner explicitly accepted and imported these versions as-is.

## What helps now

For future photos, lay one garment flat on a plain, matte surface that contrasts with its colour. Remove hangers, racks, and other objects from the frame. Keep sleeves and trouser legs separated and the entire garment in view, including straps and hems; use even light and avoid strong shadows. Photograph both shoes together for one catalogue item. Review every output against the source before approving.

A tighter working crop can reduce unrelated objects but cannot reliably remove hardware touching the garment. A local experiment on first-batch review entry 5 (dark jeans) cropped the oriented source to normalized bounds `[0.17, 0.14, 0.85, 0.97]`, then ran the same CPU BiRefNet model. Initialization took 6.00 seconds with cached weights; processing took 17.82 seconds. Visual inspection found substantially less rack, but hanger clips, a red handle, and a small rod beneath the hem remained. This is a partial improvement, not a clean result. The automated mask warnings were empty despite those visible remnants, so they cannot replace visual review.

The ignored candidate is `wardrobe-data/experiments/crop-trial/candidate.png`, alongside its working crop and measured report. It was not approved or substituted into the manifest or live catalogue. Do not apply those crop bounds to other photos automatically: they may remove fabric.

## Existing photos

The current workflow calls BiRefNet general foreground segmentation without garment-specific prompts. Repeating the same processing is unlikely to distinguish a connected rack from the garment. Edge matting refines boundaries; it does not tell the model which object you want.

The next candidate to evaluate is interactive segmentation: mark positive points on garment fabric and negative points on the hanger/rack, then inspect the generated mask and correct it locally. rembg documents SAM point prompts with positive and negative labels. This is a proposed trial, not a validated replacement: its additional model weights, CPU memory/time, fine fabric edges, and preservation of separate garment parts still need testing on these photos. Use masks only; do not generate or reconstruct garment pixels. Simple largest-component cleanup is unsafe when equipment touches fabric or a garment has separate parts.

Already imported items are deduplicated by source hash. Regenerating a cutout and rerunning import does **not** replace an existing catalogue image. Replacing one will need a deliberate update workflow that preserves the item ID and type and points it at a reviewed new image. Do not delete/reimport records to work around this.

References: [BiRefNet project](https://github.com/ZhengPeng7/BiRefNet), [rembg models and SAM point prompts](https://github.com/danielgatis/rembg).
