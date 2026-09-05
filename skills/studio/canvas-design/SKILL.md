---
name: canvas-design
description: Create beautiful static visual art — posters, design pieces, cover art — as .png or .pdf, driven by a design philosophy. Use when the user asks for a poster, a piece of art, a design, or any static, design-forward visual. Create an original composition with a coherent visual language.
---

# Canvas Design

Make an art object, not a decorated document. Establish a concise design philosophy internally, then
express it as one highly visual `.png` or `.pdf`. Output is 90% visual, 10% essential text; do not
create a separate manifesto unless the user asks for process documentation.

This is **art-led** — aesthetics lead. For a data/fact one-pager driven by numbers, use `infographic`.

## Art direction

Invent an aesthetic movement, not a layout. Name it (1–2 words: "Brutalist Joy", "Chromatic
Silence"). Write 4–6 concise paragraphs on how it manifests through space & form, color & material,
scale & rhythm, composition & balance, visual hierarchy. Keep it generic enough to leave the
expression room. Translate it into a palette, material/texture, compositional tension, scale contrast,
and one recurring form before generating.

Examples of the register:

- _"Concrete Poetry"_ — communication through monumental form: massive color blocks, sculptural
  typography (huge single words, tiny labels), Brutalist spatial tension. Text as rare gesture.
- _"Analog Meditation"_ — quiet contemplation: paper grain, ink bleeds, vast negative space,
  whispered typography, Japanese photobook calm.
- _"Geometric Silence"_ — pure order: grid precision, stark graphics, dramatic negative space,
  Swiss formalism. Structure communicates, not words.

## The subtle reference

Identify the conceptual thread from the request and weave it **invisibly** into form/color/
composition — like a jazz musician quoting a song. Those who know feel it; everyone else sees a
masterful abstract composition. Never announce it.

## Step 2 — Express it (.png / .pdf)

Build with the interpreter. The image generator makes far richer art than hand-drawn code, so reach
for it first:

- **Rich / painterly / illustrative (default)** → write a detailed art-direction prompt and
  `await render(prompt, "art.png", quality="medium")`. For a named look, `read_skill image-styles` and fold the matching
  fragment in. This register is mostly visual, so keep words minimal anyway; modern renderers spell
  short titles fine, but if a specific title or label must be exact you can composite it over the
  result with `Pillow`.
- **Geometric / typographic / precise** → when the piece is built on exact shapes, a strict grid, or
  type itself (Swiss / Brutalist / concrete-poetry registers), draw it with `reportlab` (PDF: precise
  placement) or `Pillow` / `matplotlib` (PNG: generative patterns, color fields, repeated marks) —
  code gives the precision diffusion can't.

Direction: museum/magazine quality, single page, design-forward. Favor repeating patterns, perfect
shapes, dense accumulation of marks, a limited cohesive palette, sparse clinical typography as visual
accent. Treat the abstract subject with the reverence of a scientific diagram. Typography is part of
the art (mostly thin, design-forward). **Nothing falls off the page; nothing overlaps; everything has
breathing room** — non-negotiable.

## Finish

Check the result once for obvious cropping, overlap, or broken required text. Regenerate only when the
artifact visibly misses the brief; deeper critique is an optional polish request. Multi-page work is a
sequence only when the user asks for it.
