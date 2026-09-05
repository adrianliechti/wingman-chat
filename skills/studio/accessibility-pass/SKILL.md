---
name: accessibility-pass
description: Audit an HTML/UI Studio build for accessibility — contrast, semantic HTML, keyboard/focus, motion, forms — and fix what's found. Use only when the user explicitly requests an accessibility review or a polish-pass.
---

# Accessibility Pass

Good accessibility is good design — it serves keyboard users, screen-reader users, colorblind users
(8% of men), slow networks, bright sunlight, and old devices. WCAG AA is the floor, not the ceiling.
Fix issues directly in the file; when the surface is a screenshot or mockup you can't edit, report
the findings as critique instead.

Read the file and resolve actual values (follow tokens back to their hex) before judging — don't
guess from memory.

## Contrast and color

- Compute the ratio for every resolvable text/background pair: **4.5:1** for body text (under 18px),
  **3:1** for large text (18px+ bold or 24px+) and for UI components (buttons, icons, focus rings).
  Fix every failing pair.
- Flag state communicated by **color alone** — green/red with no icon or text, a link
  distinguished only by hue, a chart with no labels. Add a second signal.
- Flag hard combinations: red+green (the most common colorblindness), blue+yellow at similar
  lightness, light gray on white, colored text on a colored background of similar brightness.

## Semantic structure

- One `<h1>`; no skipped heading levels; headings describe content, not visual size.
- The right element for the role: `<button>` not `<div onclick>`, `<a href>` for navigation,
  `<label for>` linked to every input (a placeholder is not a label — it disappears on type),
  `<nav>`/`<main>`/`<section>`/`<aside>` for landmarks.
- `alt` on every meaningful image (describe what it conveys, not what it is); `alt=""` on purely
  decorative ones so screen readers skip them.
- ARIA only where semantic HTML can't express the role — `role="button"` on a `<div>` should
  usually just be a `<button>`.

## Keyboard and focus

- Everything clickable is reachable by Tab, in reading order; no `tabindex` above 0.
- Modals close on Escape and trap focus while open; dropdowns open with Enter/Space.
- **Never `outline: none` without a replacement.** The replacement is `:focus-visible`, at least
  2px with 2px offset, 3:1 contrast against the adjacent background.
- Hit targets at least 44×44px on touch surfaces.

## Motion, forms, and the rest

- Animations and transitions respect `@media (prefers-reduced-motion: reduce)`.
- Nothing flashes more than 3 times per second (photosensitive-epilepsy risk); autoplaying motion
  has a pause control.
- Error messages are specific ("Email address is invalid", not "Invalid"), visually tied to their
  field, and wired via `aria-describedby`.
- Required fields marked by more than color; `type="email"`/`type="tel"` and `autocomplete` where
  they apply.

## Fix and report

Fix everything directly — for a borderline case (4.4:1, "very close"), fix it anyway; accessibility
is the one dimension where "almost" fails a real person. Skip only what you genuinely can't touch (a
third-party embed) and note it. End with one line: issues fixed by category and anything left for
the user.
