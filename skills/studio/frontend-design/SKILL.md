---
name: frontend-design
description: Build a distinctive, intentional web page, UI, or interactive prototype as an HTML artifact — aesthetic direction, typography, interaction wiring, and variations that don't read as templated defaults. Use whenever you're designing a landing page, web UI, clickable prototype, or HTML artifact and want it to look deliberately designed rather than generic.
---

# Frontend Design

Approach this as the design lead at a small studio known for giving every client a visual identity
that could not be mistaken for anyone else's. The client has rejected templated proposals and is
paying for a distinctive point of view: make deliberate, opinionated choices about palette,
typography, and layout specific to this brief, and take one real aesthetic risk you can justify.

Build the result in the workspace as one `.html` with inline CSS/JS and **no external CDN** so it
works offline (system fonts, or inline a font as a data URI if you need a specific one). Reference
local image/data assets by relative path — the preview serves sibling artifacts same-origin, so
`<img src="hero.jpg">` and `fetch("data.json")` just work — rather than base64-inlining them. It
renders live in the side panel: save a skeleton early and refine in place, rather than perfecting in
private and revealing at the end.

## Root it in existing context

Hi-fi design does not start from scratch when context exists. Before drawing anything, check what
the conversation and workspace already hold: a brand guide, screenshots of the existing product, a
design system or tokens file, an existing codebase. If any exist, **extract the exact values** —
lift real hex codes, font names, spacing, radii, shadow style — and match the visual vocabulary
(color tone, density, copywriting voice) before adding to it. Fidelity to what's actually there
beats your recollection of what it roughly looks like, and an invented competing look on top of a
real brand is a failure even when it's pretty. Only when the brief is truly greenfield do you invent
a direction — and then you commit to it explicitly rather than drifting into a default.

## Ground it in the subject

If the brief doesn't pin down the product/subject, pin it yourself: name one concrete subject, its
audience, and the page's single job, and state your choice. The subject's own world — its materials,
artifacts, and vernacular — is where distinctive choices come from. Build with the brief's real
content throughout.

## Design principles

- **The hero is a thesis.** Open with the most characteristic thing in the subject's world (a
  headline, image, animation, live demo). A big number + small label + gradient accent is the
  template answer — use only if it's truly best.
- **Typography carries the personality.** Pair display and body faces deliberately (not your default
  families); set an intentional type scale with real weight/width/spacing choices. Make the type
  treatment itself memorable. When the offline font choices are limited, don't expect typography
  alone to create identity — composition, color, imagery, and material treatment must carry weight too.
- **Make the subject visible.** Use a product state, real image, data shape, domain object, texture, or
  other material cue from the subject's world. A page should not become generic prose in neutral
  rectangles just because the copy is accurate.
- **Structure is information.** Numbering, eyebrows, dividers, labels should encode something true,
  not decorate. Numbered markers (01/02/03) only when the content is actually a sequence.
- **Motion deliberately.** One orchestrated moment (page-load sequence, scroll reveal, hover
  micro-interactions) usually lands harder than scattered effects. Too much animation reads as
  AI-generated.
- **Match complexity to the vision.** Maximalist needs elaborate execution; minimal needs precision
  in spacing, type, and detail. Elegance is executing the chosen vision well.

## Numbers to build on

Vague taste produces generic output; concrete scales produce intentional output. Pick these once, up
front, and reference them everywhere instead of inventing values inline:

- **Spacing** — a 4px or 8px scale (`4/8/16/24/40/64`). Off-scale padding/margins read as chaotic.
- **Type** — a defined scale (`12/14/16/18/20/24/30/36/48`), 1–2 font families max, real weight/width
  pairing rather than two near-identical sans-serifs.
- **Color** — choose a dominant field, a contrasting structural color, an accent, and readable ink.
  Unless the source brand or user asks for monochrome, use at least two chromatic roles and let one
  occupy meaningful area; gray is support, not the art direction. Use pure or toned neutrals according
  to the brief rather than treating either as inherently more designed. Building a palette from
  scratch, use `oklch()` to control lightness/chroma rather than collecting arbitrary hex values.
- **Motion** — `0.2–0.3s ease` transitions on hover/active/focus; wrap in
  `@media (prefers-reduced-motion: reduce)`.
- **Focus** — never `outline: none` without a replacement:
  `button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }`
- **Contrast** — 4.5:1 body text, 3:1 large text and UI components (WCAG AA floor).
- **One CTA per screen.** Everything else is visibly secondary — competing same-weight buttons cause
  paralysis, not choice.

## Choose a direction positively

Do not design by starting with a generic template and removing its obvious AI tells; that usually
leaves a tasteful gray shell. Start with three concrete cues from the subject's world, then translate
each into a visual decision. A material can suggest surface and depth, a physical process can suggest
layout and motion, and a native data shape can suggest rhythm or navigation.

Choose a composition whose silhouette fits the job: an immersive field, an asymmetric information
canvas, a focused product stage, a sequential story, or a dense instrument panel. Do not default to a
centered max-width column followed by interchangeable card grids. Cards are for discrete objects or
actions, not the universal container for every section.

## Process: plan → critique → build

1. Write a compact **brief-to-form map**: three subject cues and the color, composition, imagery or
   material decision each one causes. If a choice cannot be traced to the brief, replace it.
2. Define the system: 4–6 color roles, type roles, spacing/type scales, a layout silhouette, and one
   signature element that embodies the subject. Check the first viewport in grayscale mentally: its
   composition should still be recognizable, not just a header above equal cards.
3. **Critique the plan against the brief:** if the palette and layout could be dropped onto an
   unrelated startup, portfolio, or dashboard unchanged, revise them. Only then write code.
4. Watch CSS specificity — type-selectors (`.section`) and element-level classes (`.cta`) cancel each
   other's margins/paddings; structure selectors carefully.

## Interactive prototypes

When the build is a flow rather than a page, a prototype **interacts** — static screens strung
together with anchors don't count. Before writing code, map the screens and state as a comment block
at the top of the file (`Screens: 1. Welcome → 2. Email entry (validate → error|next) → …` plus the
state variables), then wire every interaction, not just the happy path:

- **Navigation** — the primary CTA advances, back goes back, state survives the transition.
- **Validation** — empty submit → inline error tied to the field; bad format → a specific message;
  valid → proceed. "Invalid input" with no field or reason is not an error message.
- **Loading** — async actions disable the trigger and show a spinner or "Loading…"; fake the latency
  with `setTimeout` rather than skipping the state — the loading state is part of what's being
  tested.
- **Feedback** — success and failure are both visible (toast, inline message, transition); the
  current screen/tab/selection/filter is always visually distinct.
- **Persistence** — current screen, form drafts, and tweak values survive a reload via
  `localStorage`. Refreshing mid-iteration is one of the most common user actions; state that
  vanishes makes the prototype feel broken.

Use real-looking sample data (plausible names, product copy, numbers), never Lorem ipsum.

## Variations

When the user wants options, variety must be **designed, not hoped for** — left unspecified,
variations drift into one default look. Before building, write one line per variation naming its
distinct palette family, type pairing, and layout skeleton; if you can't state the difference
between two variations in a sentence, one of them is redundant. Order them safe → bold: the
by-the-book take, a refined push on one or two axes, and a genuinely novel bet. Vary substantively
(layout, hierarchy, interaction model, tone) — not just an accent color.

Ship them as **one file**: a tweak panel or toggle switches between variations live (persisted to
`localStorage`), never `v1.html`/`v2.html`/`v3.html`. End with a straight recommendation — the user
decides, but a designer has an opinion, and "they're all good" isn't one.

## Restraint and self-critique

Give the signature element room, then echo its logic two or three times through color, shape, spacing,
or motion so the page feels authored rather than decorated once. Supporting areas can be quieter
without collapsing to gray. Build to a quality floor without announcing it: responsive to mobile,
visible keyboard focus, reduced-motion respected.

## Writing in the design

Words are design material, not decoration. Write from the user's side of the screen (name things by
what people control, not how the system is built). Active voice; an action keeps its name through the
flow ("Publish" → "Published"). Treat errors and empty states as direction, not mood. Sentence case,
plain verbs, no filler; each element does exactly one job.

## Optional review

When the user asks to polish the result, make it ready to ship, or run final design checks, use
`read_skill polish-pass`; otherwise skip the multi-pass review.
