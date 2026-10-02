---
name: frontend-design
description: "Design or revise a web page, UI, or interactive prototype as an HTML artifact. Use for layout, visual direction and working interactions; use html-artifacts for runtime APIs and libraries."
---

# Frontend design

Read the brief, existing artifact and relevant brand/code references first. Preserve established tokens, layout conventions and content unless redesign is requested. Treat screenshot measurements as estimates. If the subject or primary task is missing, clarify it rather than inventing a business.

For new work, choose a visual direction from the audience, purpose and subject: composition, type roles, color roles, density and imagery. Make those choices visible in the result. A useful product state, chart, image or domain object often communicates more than decorative cards. Monochrome, system fonts, flat surfaces and expressive treatments are all valid when they fit the brief.

Define reusable CSS tokens; keep related elements consistent without forcing every measurement onto an arbitrary scale. Prioritize content and actions through size, position, contrast and spacing. Use actual content; label any requested prototype data as sample. Do not invent testimonials, customer logos or business results.

Load `html-artifacts` before using bundled libraries or the preview SDK. Save editable HTML with relative companion assets, and revise it in place. Keep static content in HTML; use JavaScript for behavior. Match the requested preview or standalone delivery.

## Make the requested flow work

- Map screens, state transitions and the primary task before implementing a multi-screen prototype.
- Wire visible controls: navigation/back, filters, validation, submission and reset where relevant. Keep state consistent across transitions.
- Show real pending, success, empty and error states. Prevent duplicate submissions and recover controls after failures. Simulate latency or outcomes only when the user requests a simulation, and label it.
- Preserve drafts/preferences only when useful; use the preview store for per-artifact state. Avoid persisting sensitive input unnecessarily.
- Use semantic controls, labels, visible keyboard focus, readable contrast, responsive layout and reduced-motion handling. Motion should clarify feedback; it is optional.

Exercise the primary flow, an invalid/empty state and a narrow viewport when preview tools are available. Otherwise inspect the corresponding code and state what remains untested. Check for overflow, missing assets and dead controls.

When variants are requested, vary composition, hierarchy or interaction meaningfully and make comparison easy. Follow the requested packaging; do not add a variation selector to every page. Give a brief handoff with the file and any material limitations. Load `polish-pass` only for an explicit polish or review request.
