---
name: hierarchy-rhythm-review
description: Check an HTML/UI Studio build's visual hierarchy and spacing/type rhythm, then fix what's off. Use only when the user explicitly requests this review, says the hierarchy/spacing feels off, or requests a polish-pass.
---

# Hierarchy & Rhythm Review

Hierarchy and rhythm are what separate "intentional" from "AI-generated" at a glance. Hierarchy
guides the eye — first, second, third. Rhythm is repetition with strategic variation — what makes a
design feel considered rather than assembled. Fix issues directly in the file.

## Hierarchy

Walk every screen/section and name the primary, secondary, and tertiary elements. If you can't name
them, the hierarchy is broken. Then check each signal:

- **Size** — headings visibly larger than body; the primary CTA larger than secondary actions. Flag
  near-identical sizes across different-importance content (flat) and wildly different sizes across
  similar content (inconsistent).
- **Color** — primary actions in the saturated brand color, secondary in neutral, de-emphasized in
  light gray. Flag everything-the-same-color (no signal) or the brightest color on something minor
  (wrong signal).
- **Weight** — bold for headlines, regular for body. Flag everything-bold or everything-regular.
- **Position** — in left-to-right layouts, eyes start top-left. The most important element belongs in
  that prime real estate, not buried bottom-right.
- **Density** — loose spacing signals "pay attention here"; tight spacing signals "supporting." Flag
  the important thing being cramped while filler content gets room to breathe.
- **The 5-second test** — a first-time viewer should know what to look at and what to do within 5
  seconds. If the eye has to hunt, fix the hierarchy, not the copy.

## Rhythm

Look at the file as a whole:

- **Spacing scale** — every padding/margin/gap should snap to a consistent scale (4px or 8px
  multiples). Flag stray values (`padding: 7px`, `gap: 13px`) and snap to the nearest step.
- **Type scale** — every font-size should come from a defined scale. Flag arbitrary sizes breaking a
  16/20/24-style progression.
- **Repetition** — cards in a grid, list items, feature blocks meant to match should share padding,
  gap, and structure exactly. Near-duplicates that are subtly different should become identical, or
  deliberately different — never accidentally close.
- **Strategic variation** — a long page or deck should break its own pattern once (a background
  shift, a wider section, a centered CTA) to create rhythm. Flag total uniformity (monotonous) and a
  pattern that changes every section (chaotic).
- **Palette discipline** — 3–5 colors (plus tints/shades) across the whole build. Flag 8+ distinct
  colors or several near-identical blues/grays used interchangeably.
- **Alignment** — elements should sit on a grid. A few pixels of drift usually means inconsistent
  margins, not an intentional offset.

## Fix and report

Snap stray spacing/type values to the nearest scale step; if no scale exists yet, define one and
apply it everywhere. Where hierarchy is ambiguous, lean toward the stronger signal — an over-strong
hierarchy is easier to dial back than a flat one is to fix later. End with one line: what changed,
plus any call aggressive enough for the user to sanity-check (e.g. "made the CTA noticeably larger").
