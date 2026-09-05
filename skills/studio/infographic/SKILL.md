---
name: infographic
description: Generate a single poster-style infographic image (.png) that visualizes the key facts and numbers from the conversation and workspace material. Trigger with "make an infographic", "create a visual summary", "turn this into a one-pager graphic", or whenever the user wants a single shareable visual.
---

# Infographic

Produce one striking infographic **image** that captures the key points at a glance. Use image
generation for the visual world and deterministic layout for exact titles, labels, and numbers. The
final `.png` lands in the workspace and shows inline in chat.

This is a **data-driven** poster — real facts and numbers. For an **art-led** poster where aesthetics
lead, use `canvas-design` instead.

If image generation is unavailable, build a precise SVG/HTML infographic with the same art direction;
do not fall back to a generic report.

## Hybrid by default

Do not ask an image model to typeset critical facts. Generate a visually rich foundation — hero
object, illustration, texture, spatial frame, or background — with little or no text, then composite
the exact title, numbers, short labels, source, and simple chart marks with Pillow or SVG. This keeps
the result expressive without gambling on spelling or numerical accuracy.

The deterministic layer is not permission to make a grid of generic stat cards. Treat type, rules,
data marks, and negative space as one composition around the generated visual. Use code for precision,
not for inventing clip-art.

## 1. Gather and distil

Source = the conversation plus workspace files. Pull the real title and the **3–5** key stats/points
that matter — a poster carries a headline and a handful of numbers, not a slide's worth of bullets.
Use real numbers; never invent data. From a deck or doc, extract the text first, then cut hard.

## 2. Commit to an art direction — don't default to "plain"

A generic "modern flat-vector, clean, whitespace, grid of stat cards" prompt reads boring and
corporate. If the user names a look, use it. Otherwise derive the visual language from three concrete
subject cues: an object/environment, a material/texture, and a native information form such as a map,
cross-section, ledger, field guide, signal trace, or annotated specimen. Commit to that language rather
than mapping a whole domain to a preset style.

## 3. What makes it striking

- **One dominant hero** — a big focal visual or one huge headline number, not a uniform grid.
- **Bold, specific color** — a real palette with a confident accent, not safe grey-and-blue.
- **Intentional material** — flat, tactile, photographic, dimensional, or diagrammatic can all work;
  make the treatment specific and consistent.
- **Characterful icons/illustration**, not stock line icons.
- **Varied rhythm** — mix scale and density; asymmetry often beats a tidy 2×2.
- **Light text load** — a headline, the hero number, and short labels. Renderers handle that cleanly;
  they only stumble when one image carries a deck's worth of exact copy, so distil rather than dump.

## 4. Build the visual foundation, then typeset

Lead the image prompt with the **art direction**: style, palette, mood, composition, material, hero,
and intentional clear zones for typography. Keep exact copy out of the generated foundation.

```python
await render(
    "Portrait editorial infographic foundation about a production AI platform. Deep mineral blue field "
    "with coral and mint color blocking, tactile translucent layers, one luminous abstract network "
    "sculpture occupying the lower-right half, strong asymmetry, generous clean zones at top-left and "
    "along the left edge for later typography, no letters, no numbers, no logos.",
    "foundation.png", quality="medium", aspect_ratio="4:5"
)
```

Open `foundation.png` with Pillow, place the distilled copy using a real type hierarchy, and save
`infographic.png`. Measure text with `textbbox`, wrap deliberately, align numbers on a shared axis,
and include a compact source line. Use an available font such as DejaVu Sans/Serif or another font
already present in the source artifact.

## 5. Deliver

Save `infographic.png` to the workspace root and hand off in one line. Check the final dimensions and
that every required number matches the source. To revise, preserve the exact typography layer and
change only the art direction or layout requested.
