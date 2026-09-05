---
name: build-dashboard
description: Build a self-contained interactive HTML dashboard with ECharts, filters, KPIs, and tables. Use for executive overviews, operational monitoring, or analytical workspaces where several coordinated views need to respond to the same data.
---

# Build Dashboard — interactive, self-contained, offline

One self-contained `.html` file with embedded data and **ECharts** for live hover, filters, and
responsive charts. Build it with `execute_javascript_code`: the provided `echartsSource` global is the
minified browser bundle to embed in the file. No CDN or runtime network access.

A dashboard is for **slicing multi-dimensional data interactively** (KPIs + filters + several views).
For a single static chart, use `data-visualization`; for three numbers, a chart or a sentence is the
honest answer.

## Workflow

1. **Scope it** — purpose (exec overview / monitoring / deep-dive), audience, the KPIs that matter, the
   dimensions to filter by, the data source.
2. **Get the data** — query/parse, clean, and **embed it as a JSON array** in the file. With no real
   data, build a realistic sample matching the described schema and label it as sample.
3. **Build** the file (layout below): one state object holds `rawData` / `filteredData`; one render path
   updates KPIs, ECharts options, and the table whenever a filter changes.
4. **Verify the workflow** — exercise each filter once and confirm the KPIs, charts, table, and console
   behave correctly. Keep optional visual/accessibility reviews separate unless the user requests them.

## Layout

Choose the composition from the work, not from a universal card grid:

- **Executive overview:** one leading conclusion, a compact KPI strip, a dominant chart, then evidence.
- **Operations monitor:** status/navigation rail, dense live metrics, alerts, then the working table.
- **Analytical workspace:** persistent filters beside a large plot area, comparisons, then drill-down.

Use 2–4 KPIs and 1–3 charts, but cards only where a metric or object needs a discrete boundary. Derive
the palette and visual motif from the domain or source brand. In greenfield work, give a meaningful
surface (header, rail, plot band, or selected-state field) real chromatic presence; don't produce a
white/gray sheet with color confined to chart marks. Use a responsive grid, strong tabular-number
hierarchy, restrained depth, and a `@media print` stylesheet.

## Charts — ECharts embedded for offline use

Use the JavaScript executor's `echartsSource` string to make the final HTML independent of the app:

```javascript
const data = await vfs.readJSON("/dashboard-data.json");
const app = `
  const DATA = ${JSON.stringify(data)};
  const charts = {
    primary: echarts.init(document.getElementById('chart-primary')),
    secondary: echarts.init(document.getElementById('chart-secondary')),
  };
  function render(rows) {
    const byCategory = groupSum(rows, 'category', 'value');
    charts.primary.setOption({
      color: ['#176B87', '#EF7C45', '#665191'],
      tooltip: { trigger: 'axis' },
      grid: { left: 48, right: 20, top: 24, bottom: 40 },
      xAxis: { type: 'category', data: byCategory.labels },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: byCategory.values, itemStyle: { borderRadius: [5,5,0,0] } }]
    }, true);
    // Update the second chart, KPIs, and table from the same rows here.
  }
  addEventListener('resize', () => Object.values(charts).forEach(c => c.resize()));
  render(DATA);
`;
const html = `<!doctype html><html><head>...styles...</head><body>...dashboard...</body>
<script>${echartsSource}<\/script><script>${app}<\/script></html>`;
vfs.write("/dashboard.html", html, "text/html");
```

Derive the chart palette from the dashboard tokens and set typography, grid, axes, tooltips, and
highlight states explicitly so ECharts' defaults do not look pasted in. Prefer bar, line, scatter,
heatmap, and small multiples; use pie only for one simple part-to-whole. Dispose/recreate charts only
when the container changes — normal filtering should call `setOption`.

## Filters, KPIs & table

- **Filters:** populate each `<select>` from a field's unique values; on change recompute
  `this.filteredData = this.rawData.filter(row => …)` against all active filters, then re-render. Date
  ranges: two `<input type="date">` compared via `new Date(row.date)`.
- **KPIs:** a headline figure plus a `±x% vs prior` delta only when a comparable prior value exists.
  Abbreviate big numbers with a small `fmt()` helper (`1.2M` / `340K` / `$`), and reuse it in the
  table cells.
- **Table:** a plain `<table>`; click a header to sort (toggle asc/desc, re-render the sorted rows).

## Performance

- Embed < ~10k rows; beyond that, **pre-aggregate** to just the series the charts need (e.g. 12 monthly
  rows, not 50k raw) and embed only that.
- Line charts < ~500 points/series (downsample); bar charts < ~50 categories (else horizontal, or a
  table); paginate tables beyond ~200 visible rows.

## Deliver

Save as `<slug>.html`; one-line hand-off. It is a point-in-time snapshot — for live data, point the
user at a BI tool. To revise, edit the file in place.
