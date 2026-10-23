---
name: design-system-extract
description: "Extract reusable design tokens and a component inventory from a brand guide, codebase, screenshots or existing artifact. Use for a requested design system, not routine styling."
---

# Extract a design system

Inspect the supplied source. Record exact values from code/brand files and label screenshot-derived values as estimates. If no visual source exists, clarify the source or use `frontend-design` for a new direction; do not present invented tokens as extracted.

Capture:

- Color roles and scales, including semantic states and surfaces.
- Font families/fallbacks, weights, sizes, line heights and named text styles.
- Spacing, radii, shadows and motion values actually used.
- Repeated components, variants, relevant states and the tokens they consume.

Keep provenance for values and patterns. Report conflicting near-duplicates before proposing consolidation. Separate observed components/states from recommended additions; absence in a screenshot is not proof a state is unimplemented.

Use an output compatible with the source: CSS variables, typed tokens or the codebase's existing theme mechanism. Do not replace its architecture with a new token format unnecessarily. Write a concise component inventory alongside tokens when both are requested; include gaps and consequential decisions. Create a visual library page only when requested or needed to demonstrate the system, loading `html-artifacts` for its runtime.

Check extracted values against the source and verify syntax/references in generated files. Hand off the reusable files and distinguish faithful extraction from proposed normalization.
