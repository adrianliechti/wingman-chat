---
name: interaction-states-pass
description: Check an HTML/UI Studio build's hover, active, focus, disabled, and loading states, then fix what's missing. Use only when the user explicitly requests an interaction-state review or a polish-pass.
---

# Interaction States Pass

An interactive element missing state feedback reads as broken, not minimal. A button with no hover
state looks like a label; a disabled button that looks enabled is a dead end; a removed focus ring
locks out keyboard users. This is the safety net before an interactive build reaches the user — fix
what's missing directly in the file.

## Inventory

Walk the build and list every button, link, form input, toggle, clickable card/row, nav item, and
custom widget (dropdown, accordion, modal, popover).

## Check each element

- **Default** — looks interactive at rest (fill/border on buttons, underline or clear treatment on
  links, visible borders on inputs). Flag anything that only reveals interactivity on hover — touch
  and keyboard users never see it.
- **Hover** — a real visual change (color shift at minimum; color + shadow + a small
  `translateY(-2px)` is stronger). Never use reduced opacity for hover — it reads as disabled.
- **Active/pressed** — a darker shade or `scale(0.98)` confirms the click registered before the
  action completes.
- **Disabled** — clearly different from default and hover: ~0.6 opacity, `cursor: not-allowed`, no
  hover effect. If disabled because a condition isn't met, say why (tooltip, inline note, `title`) —
  a silently-disabled control is a dead end.
- **Focus** — a visible ring via `:focus-visible` (not `:focus`, so it doesn't fire on every mouse
  click): at least 2px, 2px offset, 3:1 contrast against the adjacent background. `outline: none` is
  never used without a replacement.
- **Loading** (anything triggering async work) — disable immediately on click to block
  double-submit, swap the label for a spinner or "Loading…", restore on completion. Elements that
  fetch on render get a skeleton or spinner while waiting.

## Transitions

State changes should be smooth, not snapped:

```css
button {
  transition:
    background 0.2s ease,
    transform 0.2s ease,
    box-shadow 0.2s ease;
}
```

0.15–0.3s for hover/focus/active; 0.3–0.5s for modals/drawers/toasts entering or leaving. Faster
feels jarring, slower feels laggy, none feels broken. Wrap in
`@media (prefers-reduced-motion: reduce)` so motion shortens for users who ask for less of it.

## Feedback for actions

Every action needs a visible result: a toast or inline message on submit success/failure, field-tied
validation errors that appear and clear as the user fixes them, an immediate visual change on toggle/
select/filter. A silent success or silent failure both read as broken. The current page/tab, selected
item, and active filter should always be visually distinct from their neighbors.

## Fix and report

Add whatever's missing, using the build's existing tokens for color/timing where they exist, or the
defaults above where they don't. For an ambiguous case (e.g. what counts as "active" on a toggle),
make the call and note it. End with one line: elements inventoried, states added by category, done.
