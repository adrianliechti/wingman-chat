---
name: interaction-states-pass
description: "Review and fix HTML/UI interaction feedback when requested, or during polish-pass. Covers controls, validation, asynchronous states, navigation and recovery."
---

# Interaction states review

Read the implementation and inventory meaningful controls and user paths. Test with available browser tools; otherwise trace handlers and state transitions and state the testing limit.

Check controls for a clear purpose at rest, appropriate hover/pressed feedback, keyboard operation and visible focus. Disabled controls should communicate the condition preventing use. Preserve native semantics and existing design tokens; do not mandate movement, opacity or transitions.

For asynchronous work, show actual pending status, prevent duplicate submission, recover controls on failure and present useful success/error feedback. Guard against stale responses after a newer request or navigation. Do not manufacture loading delays or success responses to make the interface look active.

For forms, connect validation errors to fields and keep entered data through recoverable failures. Check selection/current-page indicators, back/reset behavior, empty results and any promised persistence. Test at least a success path, failure/invalid path and repeated action where relevant.

Use motion only when it helps, respecting reduced-motion preferences. Do not add local storage or extra confirmations unless the workflow needs them.

Fix within the requested scope; for review-only requests, provide findings. Recheck changed paths and report remaining nonfunctional or untested behavior.
