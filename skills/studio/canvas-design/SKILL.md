---
name: canvas-design
description: "Create or edit static imagery, illustrations, posters, covers or visual design pieces. Includes image style direction; use infographic for fact-led graphics and algorithmic-art for art made through code."
---

# Static visual design

Read the brief and references for subject, required copy, dimensions, medium and style. Choose a coherent composition, palette, material/texture and type treatment. Preserve the user's visual direction; do not force abstraction, sparse text or a house style.

Choose the production method from the work:

- Use create_image for photographic, painterly or illustrative images, or the interpreter's render helper within a file-processing pipeline. Use supplied reference inputs when editing and supported controls for transparency, shape and quality.
- Use authored SVG, Pillow, matplotlib or ReportLab for exact geometry, diagrams or typography.
- Combine generated imagery with deterministic typesetting when required words, logos, labels or numbers must be exact.

Keep the required text and content central to the composition. Use supplied branding and assets where available; do not replace a specific logo with a generated approximation. Plan safe areas, crop and aspect ratio before generating. Overlap or bleed may be intentional; prevent accidental clipping of required content.

For a requested style, describe the few visible properties that distinguish it: material, line weight, perspective, lighting or texture. Preserve the subject, identity and explicit constraints; avoid conflicting style lists. [Image styles](references/image-styles.md) provides optional prompt fragments and the Canvas picker's choices. Read it only to match a named preset or compare style options; do not choose a preset for every task.

If image generation is unavailable, use a suitable code-based method and state any material difference. Do not claim an image was generated when it was not.

Inspect the actual output for requested text, proportions, unwanted artifacts and readability at the delivery size. Revise visible misses rather than adding arbitrary polish rounds. Save in the requested format, or choose one suited to the medium, and identify the file.
