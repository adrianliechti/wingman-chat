---
name: accessibility-pass
description: "Review HTML/UI accessibility and fix issues when requested, including as part of polish-pass. Covers semantics, keyboard/focus, contrast, forms and motion."
---

# Accessibility review

Read the artifact and relevant styles; resolve actual values rather than guessing. Follow the requested review scope. If only a screenshot is available, report visible findings and mark interaction/semantics as untested. Do not imply a complete compliance audit from static inspection.

Check:

- Semantic controls and landmarks, descriptive heading hierarchy, input labels, useful image alternatives and decorative images with empty alt text.
- Keyboard access, logical focus order, visible focus, modal focus containment/restoration and Escape behavior where appropriate.
- Text/background contrast, including states and overlays. Target at least 4.5:1 for ordinary text and 3:1 for large text (24 CSS px, or about 18.67px bold); essential control boundaries/icons need 3:1 against adjacent colors.
- Meaning conveyed by text, shape or pattern as well as color.
- Clear field errors connected to inputs, required-state cues and understandable recovery.
- Usable controls at narrow viewports and zoom; sufficiently large or spaced targets.
- Reduced-motion preferences, pause controls for sustained motion and absence of flashing effects.

Fix confirmed issues within scope using the existing design system. Recheck affected states so a contrast or focus fix does not create clipping or obscure content. For review-only requests, provide findings without changing files.

Report concrete fixes/findings and material checks that remain untested. Do not change palette, fonts or layout merely because they differ from a preferred style.
