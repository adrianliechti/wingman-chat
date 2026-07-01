---
name: build-dashboard
description: Build an interactive HTML dashboard with charts, filters, and tables. Use when creating an executive overview with KPI cards, turning query results into a shareable self-contained report, building a team monitoring snapshot, or needing multiple charts with filters in one browser-openable file.
---

# Build Dashboard — interactive, self-contained, offline

One self-contained `.html` file: KPI cards, charts, filters, a sortable table. Data embedded as JSON,
charts drawn with **Plotly, its library inlined** — **no CDN, fully offline**. Offline is the point:
never pull a chart library from a CDN; inline it once and the file works anywhere.

A dashboard is for **slicing multi-dimensional data interactively** (KPIs + filters + several views).
For a single static chart, use `data-visualization`; for three numbers, a chart or a sentence is the
honest answer.

## Workflow

1. **Scope it** — purpose (exec overview / monitoring / deep-dive), audience, the KPIs that matter, the
   dimensions to filter by, the data source.
2. **Get the data** — query/parse, clean, and **embed it as a JSON array** in the file. With no real
   data, build a realistic sample matching the described schema and label it as sample.
3. **Build** the file (layout below): a small `Dashboard` class holds `rawData` / `filteredData` and
   re-renders KPIs, charts, and the table whenever a filter changes.
4. **Verify like a bug hunt** — open it, exercise _every_ filter, confirm KPIs/charts/table all update
   and the console is clean. Done when a full pass finds nothing, not when it first renders.

## Layout

```
┌─ Title ───────────────────────────────── [ Filters ▼ ] ─┐
│ [ KPI ] [ KPI ] [ KPI ] [ KPI ]                          │
│ [ Primary chart            ] [ Secondary chart ]         │
│ [ Detail table (sortable, scrollable)          ]         │
└──────────────────────────────────────────────────────────┘
```

2–4 KPI cards (headline number + Δ vs prior period), 1–3 charts, an optional sortable table. Style it
yourself: responsive grid (`repeat(auto-fit, minmax(...))`), card-based with subtle shadows, system
fonts, a restrained accent palette (shared across all figures), and a `@media print` stylesheet.

## Charts — Plotly, inlined for offline

Don't hand-roll chart code or pull a library from a CDN. Use **Plotly**: inline the library once so the
file stays offline, then build each chart from the current `filteredData` in JS and (re)draw with
`Plotly.react` — cheap to call on every filter change, so one render path updates KPIs, charts, and
table together.

Inline the library from Python when you assemble the file:

```python
import plotly.io as pio
PLOTLYJS = pio.get_plotlyjs()      # the full library as a string — embed in one <script>, no CDN
# ...write the page with <script>{PLOTLYJS}</script> in <head>, data as JSON, and the JS below
```

```javascript
const COLORS = ["#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B3", "#937860"];
const LAYOUT = {
  margin: { t: 24, r: 16, b: 40, l: 56 },
  colorway: COLORS,
  font: { size: 12 },
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
};
const CONFIG = { displayModeBar: false, responsive: true };

function drawCharts(rows) {
  // call on load and after every filter change
  const byCat = groupSum(rows, "category", "value"); // your aggregation helpers
  Plotly.react(
    "chart-bar",
    [{ type: "bar", x: byCat.labels, y: byCat.values, marker: { color: COLORS[0] } }],
    { ...LAYOUT, title: "Value by category" },
    CONFIG,
  );
  Plotly.react(
    "chart-line",
    series.map((s, i) => ({
      type: "scatter",
      mode: "lines+markers",
      name: s.label,
      x: s.x,
      y: s.y,
      line: { color: COLORS[i % COLORS.length] },
    })),
    { ...LAYOUT, title: "Trend" },
    CONFIG,
  );
}
```

`Plotly.react` initializes an empty `<div id="chart-bar">` on first call and updates it after — no
separate setup, no animation state to manage. Theme every figure with the shared `LAYOUT`/`COLORS` so
the dashboard reads as one piece. Use `bar` / `scatter` (lines) / `histogram` / `heatmap`, and `pie`
only for a single part-to-whole; for >~10k points switch the trace to `scattergl`.

## Filters, KPIs & table

- **Filters:** populate each `<select>` from a field's unique values; on change recompute
  `this.filteredData = this.rawData.filter(row => …)` against all active filters, then re-render. Date
  ranges: two `<input type="date">` compared via `new Date(row.date)`.
- **KPIs:** a headline figure plus a coloured `±x% vs prior` delta. Abbreviate big numbers with a
  small `fmt()` helper (`1.2M` / `340K` / `$`), and reuse it in the table cells.
- **Table:** a plain `<table>`; click a header to sort (toggle asc/desc, re-render the sorted rows).

## Performance

- Embed < ~10k rows; beyond that, **pre-aggregate** to just the series the charts need (e.g. 12 monthly
  rows, not 50k raw) and embed only that.
- Line charts < ~500 points/series (downsample); bar charts < ~50 categories (else horizontal, or a
  table); paginate tables beyond ~200 visible rows.

## Deliver

Save as `<slug>.html` (it embeds Plotly, ~3.5 MB, so it opens offline); one-line hand-off. It's a
point-in-time snapshot — for live data, point the user at a BI tool. To revise, edit the file in place.
