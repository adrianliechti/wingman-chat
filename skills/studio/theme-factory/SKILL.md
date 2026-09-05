---
name: theme-factory
description: Create or apply a cohesive visual theme for a deck, document, report, or HTML artifact. Use only when the user asks for a theme, reusable visual direction, palette/type system, or wants an existing artifact re-themed.
---

# Theme Factory

Create a theme that belongs to the subject and works across the target medium. A theme is not merely
four attractive hex values: it joins field, ink, type, image treatment, geometry, and annotation into
one reusable visual logic.

## Derive the direction

Read the brief and any brand/source material. Identify:

1. **Audience and occasion** — decision, launch, teaching, publication, operations, or commemoration.
2. **Three subject cues** — a material, environment/object, and native information form.
3. **Desired register** — precise, intimate, urgent, optimistic, monumental, playful, or restrained.

Translate each cue into a visible choice. If a choice could be transferred unchanged to an unrelated
artifact, it is not specific enough. Ask the user only when two genuinely different directions would
materially change the result; otherwise make and explain the choice.

## Define the system

- **Color roles:** field, alternate field if needed, ink, structural color, signal accent, and semantic
  warning/success only when the content uses those meanings. Pull from brand or subject evidence where
  available. Do not default to dark navy, purple tech gradients, or gray with a tiny accent.
- **Type roles:** display, body, label/data, and numeric treatment. Use no more than two families and
  choose fallbacks available in the target runtime.
- **Composition:** name the layout silhouette and density: immersive field, asymmetric editorial,
  strict analytical grid, annotated object, sequential strip, or another brief-specific form.
- **Signature:** define one repeatable subject-derived behavior such as crop style, measurement marks,
  archival captions, map coordinates, material edges, or chart annotations.
- **Surface:** specify borders, radii, shadows, texture, and image treatment as a coherent material
  language. Cards are only for discrete objects or actions.

Check contrast and reproduction in the destination medium. Exact black/white, monochrome, flat color,
or maximal color are all valid when they serve the direction.

## Apply

Express the system as reusable tokens and named styles: CSS variables for HTML, named styles/theme
colors for Office documents, or shared constants for drawing/PDF code. Apply it consistently while
allowing composition and density to vary with the content. When the user asks for a reusable theme as
the deliverable, save a concise `theme.md` with tokens, type roles, composition, signature, surface,
and do/don't examples; otherwise apply the theme directly without creating extra process artifacts.
