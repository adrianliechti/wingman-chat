---
name: canvas-design
description: Create beautiful static visual art — posters, design pieces, cover art — as .png or .pdf, driven by a design philosophy. Use when the user asks for a poster, a piece of art, a design, or any static, design-forward visual. Create original work, never copying existing artists.
---

# Canvas Design

Make an art object, not a decorated document. Work in two steps: **(1) write a design philosophy**
(a short manifesto, saved as `.md`), then **(2) express it on a canvas** as a single highly-visual
`.png` or `.pdf`. Output is 90% visual, 10% essential text.

This is **art-led** — aesthetics lead. For a data/fact one-pager driven by numbers, use `infographic`.

## Step 1 — Design philosophy (.md)
Invent an aesthetic movement, not a layout. Name it (1–2 words: "Brutalist Joy", "Chromatic
Silence"). Write 4–6 concise paragraphs on how it manifests through space & form, color & material,
scale & rhythm, composition & balance, visual hierarchy. Keep it generic enough to leave the
expression room. **Emphasize craftsmanship repeatedly** — the final work must look meticulously
crafted, labored over, master-level. Save as `philosophy.md`.

Examples of the register:
- *"Concrete Poetry"* — communication through monumental form: massive color blocks, sculptural
  typography (huge single words, tiny labels), Brutalist spatial tension. Text as rare gesture.
- *"Analog Meditation"* — quiet contemplation: paper grain, ink bleeds, vast negative space,
  whispered typography, Japanese photobook calm.
- *"Geometric Silence"* — pure order: grid precision, stark graphics, dramatic negative space,
  Swiss formalism. Structure communicates, not words.

## The subtle reference
Identify the conceptual thread from the request and weave it **invisibly** into form/color/
composition — like a jazz musician quoting a song. Those who know feel it; everyone else sees a
masterful abstract composition. Never announce it.

## Step 2 — Express it (.png / .pdf)
Build with the interpreter. Two good paths:
- **Vector/print** → `reportlab` (PDF canvas: shapes, type, precise placement) or `Pillow`/
  `matplotlib` (PNG: generative patterns, color fields, repeated marks).
- **Rich/painterly** → write a detailed art-direction prompt and `await render(prompt, "art.png")`,
  then optionally composite text/marks over it with Pillow.

Direction: museum/magazine quality, single page, design-forward. Favor repeating patterns, perfect
shapes, dense accumulation of marks, a limited cohesive palette, sparse clinical typography as visual
accent. Treat the abstract subject with the reverence of a scientific diagram. Typography is part of
the art (mostly thin, design-forward). **Nothing falls off the page; nothing overlaps; everything has
breathing room** — non-negotiable.

## Refine
Make a second pass: don't add graphics — make what's there crisper and more cohesive. Re-open the
rendered `.png`/`.pdf` and look at it critically (use `vision()` if available) — fix anything that fell
off the page, overlaps, or reads as generic. If the instinct
is to draw a new shape, ask instead "how do I make what's here more of a piece of art?" Output the
final `.png`/`.pdf` alongside `philosophy.md`. Multi-page → bundle as a coffee-table sequence, each
page a distinct twist on the philosophy.
