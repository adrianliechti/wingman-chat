---
name: ai-slop-check
description: Scan a Studio HTML/UI build for generic AI-template visual tropes and fix them. Use only when the user explicitly asks whether it looks AI-generated, asks to remove the slop, or requests a polish-pass.
---

# AI Slop Check

Scan for the visual tropes that make a design read as "AI-generated template" rather than
intentional. A page indistinguishable from a hundred other AI outputs failed to look like _this_
subject's design. Fix everything found, directly in the file — this isn't a report to hand back,
it's a pass with your hands on the code.

Read the file (and any CSS/tokens it references) before judging — resolve actual hex/px values,
don't guess from memory.

## What to detect and replace

**Generic gradients.** Rainbow or fashionable hero blends used without a subject/brand reason →
replace with a brief-specific color field, image, texture, pattern, or deliberate color blocking. Do
not "fix" them by draining the page to gray.

**Emoji.** 🚀/✅/🎉 prepended to headlines, buttons, or list items with no brand reason → remove; if
the layout leaned on the emoji for visual weight, swap in a real icon (Feather, Material, Phosphor,
Heroicons) or fix the typographic hierarchy instead.

**Cards.** `border-radius: 12px; border-left: 4px solid #...` as the _default_ container style → a
subtle shadow, thin all-around border, or background contrast. Keep the left-border only where it's
semantic (callout, alert, status) or matches an existing design system.

**Imagery.** Generic hand-drawn SVG people/scenes/blobs or "giant-head" illustrations → a real source
image, a brief-specific generated asset, a professional icon treatment, or a purposeful abstract/data
motif. Use a labelled placeholder only for an explicit wireframe or design handoff, never a finished
artifact.

**Type.** Inter, Roboto, Arial, Fraunces, or a bare system stack used as a silent default (no brand or
user reason) → a font chosen with intent for this subject; `read_skill frontend-design` for pairing
guidance.

**Color values.** Five near-identical blues (`#0066CC`, `#0077DD`, `#3498DB`...) invented inline →
consolidate to a token or an `oklch()`-derived palette (same lightness/chroma, varied hue) so hues
read as related.

**Spacing.** Off-scale values (`padding: 7px 15px`, `gap: 13px`) → snap to a 4px or 8px scale.

**The cream/serif/terracotta house style.** `#F4F1EA`-family background + serif display (Georgia,
Playfair, Fraunces) + italic word-accents + terracotta/amber accent, all together, with no brand
reason → today's default-template look, especially wrong on dashboards, dev tools, fintech,
healthcare, or enterprise surfaces. Any one element can be a deliberate choice for editorial/
hospitality/portfolio work; all of them together without a stated reason is a trope. Replace with a
direction actually chosen for this brief.

## Fix and report

Apply fixes directly. Where more than one replacement is reasonable (which non-Inter font, exactly
which shade), pick the most defensible option and note it in the handoff so the user can override.
Removing a trope must reveal a more subject-specific direction; desaturation and generic neutral
minimalism are not successful cleanup.
End with one line: tropes found (by category) and what changed — not a table, not a report.
