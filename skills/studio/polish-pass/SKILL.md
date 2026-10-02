---
name: polish-pass
description: "Review or polish an HTML/UI artifact, including hierarchy, spacing, typography or a generic template look. Use for requested critique or fixes; keep focused reviews within the named area."
---

# Polish pass

Read the artifact and identify the user's requested review/fix scope. Preserve the approved direction and working behavior. If structural problems block meaningful polish, address in-scope defects and identify the remainder; do not initiate a mandatory approval interview.

Load only relevant checks:
- `accessibility-pass`: semantics, contrast, keyboard/focus, forms and motion.
- `interaction-states-pass`: controls, async behavior, validation and recovery.
- [Visual review](references/visual-review.md): hierarchy, spacing, typography and generic design choices. Read with read_skill_resource, skill polish-pass.

For a focused request, use only that check; a spacing critique does not require a full audit. For a final polish pass, use the checks relevant to the artifact. A static visual does not need an interaction review. Resolve actual styles and behavior before reporting defects. Combine overlapping findings and separate confirmed failures from subjective recommendations.

Fix blocking behavior and accessibility issues first, then in-scope visual inconsistencies. Keep broader redesign proposals separate. Respect review-only requests. Recheck affected paths and representative viewports when possible; document limits when no rendered inspection is available.

Conclude with the meaningful fixes/findings, unresolved defects and what was verified. Do not claim production readiness or complete accessibility compliance from a limited pass.
