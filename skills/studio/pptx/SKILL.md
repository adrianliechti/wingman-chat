---
name: pptx
description: "Create or edit an editable PowerPoint (.pptx) presentation. Use for requested slide decks; preserve an existing deck's template and scope when revising."
---

# PowerPoint decks

Use `python-pptx` in the interpreter. Read the source material and identify the audience, purpose, required content and requested length. Build a short narrative before laying out slides; do not add slides just to reach a fixed count. Make claims and figures traceable.

Open existing decks with `Presentation("deck.pptx")` and edit relevant shapes while preserving masters/layouts. For new decks, set the intended aspect ratio and reusable colors, type roles, margins and figure treatments. Select layouts from the actual template rather than assuming a fixed blank-layout index.

Update text runs when their formatting must survive; assigning `text_frame.text` replaces the run structure. Do not assume slide duplication is a public python-pptx operation or copy slide XML without its relationships. Remove unused template slots as complete groups so placeholder imagery does not remain.

Give each slide a clear focal point. Use specific titles supported by the content and varied layouts where the material warrants them. Match the brand and requested style; avoid imposing a universal palette or decorative motif. Keep content editable where practical.

- Use native charts with real data when editability matters; use matplotlib figures for chart types the native API cannot express. Do not fake quantitative charts with arbitrary shapes.
- Use consistent chart scales, units, labels and sources.
- Crop images deliberately; never stretch them. Use generated imagery only when it serves the brief and the service is available.
- Place detail in speaker notes where appropriate: `slide.notes_slide.notes_text_frame.text`.
- Size text for the viewing context. For projected decks, aim for body text around 18pt or larger and avoid tiny footnotes; simplify or split crowded content.

Reopen the saved file and check slide count, expected text, chart data, shape bounds and unintended overlaps. Read titles in order for a coherent argument. Inspect rendered slides if a preview is available; coordinate checks alone cannot prove text fits. Preserve intentional whitespace. Save the .pptx and give a brief handoff with consequential limitations.
