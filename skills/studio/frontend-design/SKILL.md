---
name: frontend-design
description: Guidance for distinctive, intentional visual design when building a web page or UI — aesthetic direction, typography, and choices that don't read as templated defaults. Use whenever you're designing a landing page, web UI, or HTML artifact and want it to look deliberately designed rather than generic.
---

# Frontend Design

Approach this as the design lead at a small studio known for giving every client a visual identity
that could not be mistaken for anyone else's. The client has rejected templated proposals and is
paying for a distinctive point of view: make deliberate, opinionated choices about palette,
typography, and layout specific to this brief, and take one real aesthetic risk you can justify.

Build the result as a **self-contained `.html`** in the workspace — inline CSS/JS, **no external CDN**
so it works offline (system fonts, or inline a font as a data URI if you need a specific one). It
renders in the side panel.

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
  treatment itself memorable.
- **Structure is information.** Numbering, eyebrows, dividers, labels should encode something true,
  not decorate. Numbered markers (01/02/03) only when the content is actually a sequence.
- **Motion deliberately.** One orchestrated moment (page-load sequence, scroll reveal, hover
  micro-interactions) usually lands harder than scattered effects. Too much animation reads as
  AI-generated.
- **Match complexity to the vision.** Maximalist needs elaborate execution; minimal needs precision
  in spacing, type, and detail. Elegance is executing the chosen vision well.

## Avoid the AI-design defaults
Current AI design clusters on three looks: (1) warm cream (~#F4F1EA) + high-contrast serif display +
terracotta accent; (2) near-black + a single acid-green/vermilion accent; (3) broadsheet layout with
hairline rules, zero radius, dense columns. All are legitimate *for some briefs*, but they appear
regardless of subject. Where the brief pins a direction, follow it exactly. Where it leaves an axis
free, **don't spend that freedom on a default** — make a choice for *this* subject.

## Process: plan → critique → build
1. Brainstorm a compact **token system**: Color (4–6 named hex values), Type (2+ roles — a
   characterful display face used with restraint, a body face, a utility face), Layout (a concept,
   with one-line prose + ASCII wireframes), and a **Signature** (the one element the page is
   remembered by, embodying the brief).
2. **Critique the plan against the brief:** if any part reads like the generic default you'd produce
   for any similar page, revise it and say what changed. Only then write code, deriving every color
   and type decision from the plan.
3. Watch CSS specificity — type-selectors (`.section`) and element-level classes (`.cta`) cancel each
   other's margins/paddings; structure selectors carefully.

## Restraint and self-critique
Spend your boldness in one place — let the signature element be the memorable thing and keep
everything around it quiet. Build to a quality floor without announcing it: responsive to mobile,
visible keyboard focus, reduced-motion respected. Chanel's rule: before leaving the house, remove one
accessory.

## Writing in the design
Words are design material, not decoration. Write from the user's side of the screen (name things by
what people control, not how the system is built). Active voice; an action keeps its name through the
flow ("Publish" → "Published"). Treat errors and empty states as direction, not mood. Sentence case,
plain verbs, no filler; each element does exactly one job.
