---
name: design-system-extract
description: Extract a design system from a brand guide, codebase, screenshots, or finished artifact. Use when the user explicitly asks for tokens, a component inventory/library, or to turn an existing visual language into a reusable system.
---

# Design System Extract

Turn a visual source into structure: a **tokens file** future designs reference instead of
re-deriving values, and a **component inventory** that shows the reusable pieces hiding inside a
one-off design. Extract from what actually exists — a codebase's theme files, a brand guide,
screenshots, or an artifact built earlier in this workspace. Values from code/brand files are exact;
values sampled from screenshots are estimates and must be labelled as such. If there is no source at
all, this is not extraction — build a direction with `frontend-design` instead.

## Extract tokens

Walk each category and record concrete values with their source name and intended use:

- **Color** — brand primary/accent (with variants), semantic (success/warning/error/info), the
  neutral scale (note its tone: warm/cool/neutral), and surfaces (background, card, border). Where
  the source has near-duplicates (five slightly different blues), **don't silently merge them** —
  the inconsistency is a finding; list it and propose the canonical value.
- **Typography** — families with full fallback stacks, the actual size scale in use, only the
  weights actually deployed, line heights (tight/normal/loose), named text styles if the source
  defines them.
- **Spacing** — the real scale in use (usually 4px or 8px base), not a generic one. Off-scale
  outliers are findings.
- **Radii, shadows, motion** — the distinct radius steps, the elevation set (full CSS values), and
  transition durations/easings if defined.

Emit the tokens as an artifact matching the source's world: `tokens.css` with custom properties by
default; a Tailwind config extension or typed `tokens.ts` when the source codebase uses those.

## Inventory components

Walk the design surface and ask of each element: does this pattern repeat (or plausibly will)? Does
it have variants? States? If yes, it's a component. Group as atoms (button, input, badge, avatar),
molecules (form field, card, toast, modal), and organisms (header, table, hero, empty state). For
each, capture: name, one-line purpose, variants, states (default/hover/active/focus/disabled/
loading), the tokens it uses, and one do/don't.

The gaps are part of the deliverable: three near-identical button styles that should be one,
components missing a focus or disabled state, values that bypass the token scale. Flag each with a
recommendation — this list is the work needed to turn the design into a system.

Write the inventory as `component-inventory.md` alongside the tokens file. If the user wants to see
it, optionally render a library page — each component with its variants and states — as an HTML
artifact.

## Hand off

One line per output file, plus the findings that need a decision (inconsistencies to consolidate,
gaps the source never defined — those are the user's calls, not yours to fill silently). Subsequent
designs in this workspace should reference these tokens instead of inventing values; when a new
value is needed, add it to the tokens file first, then use it.
