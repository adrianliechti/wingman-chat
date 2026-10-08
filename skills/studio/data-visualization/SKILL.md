---
name: data-visualization
description: "Create static or interactive charts from real data. Use for analytical or publication figures in PNG/SVG, or an HTML chart; use visualize for conceptual illustrations."
---

# Data visualization

Read the source, inspect types, missing values, units and date ranges, and identify the comparison the chart must support. Keep observations distinct from estimates and requested synthetic examples. Check transformations and aggregations against source totals.

Use matplotlib/seaborn for static PNG/SVG and publication figures. Save with explicit dimensions/resolution, readable labels and unclipped bounds; close figures after saving. Use ECharts for interactive HTML previews: load `html-artifacts` and read `references/libraries.md`; read `references/duckdb.md` if data should be queried at runtime. Follow its export rules when the user needs a standalone file.

Choose the encoding from the analytical question:

- Time trend: line; preserve chronological order and reveal missing intervals.
- Category comparison/ranking: bars or dots; sort unless an intrinsic order matters.
- Distribution: histogram, box or violin; disclose binning and sample size where consequential.
- Relationship: scatter; distinguish association from causal claims.
- Part-to-whole: stacked bars or a simple pie with few categories when proportions are the point.
- Many comparable series: small multiples with consistent scales.

Bars encode length and need a zero baseline; disclose meaningful truncation on other axes. Avoid decorative 3D and misleading area encodings. Use dual axes only when justified and unmistakably labelled. Show uncertainty when available; do not invent it.

Match the destination's style. Color should encode a category, quantity or emphasis; use labels, line styles or patterns so distinctions survive without color. Label axes with units and annotate relevant findings. Use an insight title only when supported; an exploratory chart may have a descriptive title. Include source, date range and consequential filters.

Before delivery, verify data-to-mark correspondence, denominator choices, scale consistency, legend/label legibility and exported bounds. For interactive charts, check resizing, tooltips, empty states and controls. Save the requested format and identify the file.
