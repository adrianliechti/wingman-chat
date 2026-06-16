---
name: build-dashboard
description: Build an interactive HTML dashboard with charts, filters, and tables. Use when creating an executive overview with KPI cards, turning query results into a shareable self-contained report, building a team monitoring snapshot, or needing multiple charts with filters in one browser-openable file.
---

# Build Dashboard — interactive, self-contained, offline

One self-contained `.html` file: KPI cards, charts, filters, a sortable table. Data embedded as JSON,
charts drawn as **inline SVG with vanilla JS** — **no library, no CDN, fully offline**. That offline
guarantee is the reason this skill exists: never reach for Chart.js / D3 / Plotly from a CDN.

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
4. **Verify like a bug hunt** — open it, exercise *every* filter, confirm KPIs/charts/table all update
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
fonts, a restrained accent palette (`CHART_COLORS` below), and a `@media print` stylesheet.

## Charts — inline SVG (no dependencies)

Drop these helpers in a `<script>`. Each renders into a `<div id="…" class="chart">` and is
**idempotent** — recompute arrays from `filteredData` and call it again to redraw (replacing
`innerHTML` is instant; no animation state). Native `<title>` gives hover tooltips for free.

```javascript
const CHART_COLORS = ['#4C72B0', '#DD8452', '#55A868', '#C44E52', '#8172B3', '#937860'];

function formatValue(v, fmt = 'number') {
  if (fmt === 'percent') return `${v.toFixed(1)}%`;
  const s = v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : `${Math.round(v)}`;
  return fmt === 'currency' ? `$${s}` : s;
}

function renderBarChart(elId, labels, values, opts = {}) {
  const W = 600, H = 320, P = { l: 52, r: 16, t: 12, b: 44 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const max = Math.max(1, ...values), bw = iw / Math.max(1, labels.length);
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = P.t + ih - (ih * i) / 4;
    g += `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="#e9ecef"/><text x="${P.l - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6c757d">${formatValue((max * i) / 4, opts.format)}</text>`; }
  let bars = '';
  values.forEach((v, i) => { const h = ih * (v / max), x = P.l + bw * i + bw * 0.15, w = bw * 0.7, y = P.t + ih - h;
    bars += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${opts.color || CHART_COLORS[0]}"><title>${labels[i]}: ${formatValue(v, opts.format)}</title></rect><text x="${x + w / 2}" y="${H - P.b + 16}" text-anchor="middle" font-size="11" fill="#6c757d">${labels[i]}</text>`; });
  document.getElementById(elId).innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="bar chart">${g}${bars}</svg>`;
}

function renderLineChart(elId, labels, series, opts = {}) {   // series: [{ label, data: [...] }, …]
  const W = 600, H = 320, P = { l: 52, r: 16, t: 12, b: 44 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const max = Math.max(1, ...series.flatMap((s) => s.data));
  const X = (i) => P.l + (iw * i) / Math.max(1, labels.length - 1), Y = (v) => P.t + ih - ih * (v / max);
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = P.t + ih - (ih * i) / 4;
    g += `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="#e9ecef"/><text x="${P.l - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6c757d">${formatValue((max * i) / 4, opts.format)}</text>`; }
  let lines = '';
  series.forEach((s, si) => { const c = CHART_COLORS[si % CHART_COLORS.length];
    lines += `<polyline points="${s.data.map((v, i) => `${X(i)},${Y(v)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2"/>` + s.data.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="${c}"><title>${labels[i]}: ${formatValue(v, opts.format)}</title></circle>`).join(''); });
  const xl = labels.map((l, i) => `<text x="${X(i)}" y="${H - P.b + 16}" text-anchor="middle" font-size="11" fill="#6c757d">${l}</text>`).join('');
  document.getElementById(elId).innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="line chart">${g}${lines}${xl}</svg>`;
}

function renderDoughnutChart(elId, labels, values) {
  const total = values.reduce((a, b) => a + b, 0) || 1, R = 70, C = 2 * Math.PI * R, cx = 90, cy = 90;
  let off = 0, segs = '', legend = '';
  values.forEach((v, i) => { const len = C * (v / total), c = CHART_COLORS[i % CHART_COLORS.length];
    segs += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${c}" stroke-width="28" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})"><title>${labels[i]}: ${formatValue(v)} (${((100 * v) / total).toFixed(1)}%)</title></circle>`;
    legend += `<div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0"><span style="width:10px;height:10px;border-radius:2px;background:${c};display:inline-block"></span>${labels[i]} — ${formatValue(v)}</div>`; off += len; });
  document.getElementById(elId).innerHTML = `<div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;justify-content:center"><svg viewBox="0 0 180 180" width="180" height="180" role="img">${segs}</svg><div>${legend}</div></div>`;
}
```

For a **very dense** statistical chart, render a PNG with the Python interpreter (`matplotlib`) and
embed it as a base64 `data:` URI instead of drawing thousands of SVG nodes.

## Filters, KPIs & table

- **Filters:** populate each `<select>` from a field's unique values; on change recompute
  `this.filteredData = this.rawData.filter(row => …)` against all active filters, then re-render. Date
  ranges: two `<input type="date">` compared via `new Date(row.date)`.
- **KPIs:** a headline `formatValue(total, 'currency')` plus a coloured `±x% vs prior` delta.
- **Table:** a plain `<table>`; click a header to sort (toggle asc/desc, re-render the sorted rows).

## Performance

- Embed < ~10k rows; beyond that, **pre-aggregate** to just the series the charts need (e.g. 12 monthly
  rows, not 50k raw) and embed only that.
- Line charts < ~500 points/series (downsample); bar charts < ~50 categories (else horizontal, or a
  table); paginate tables beyond ~200 visible rows.

## Deliver
Save as `<slug>.html`; one-line hand-off. It's a point-in-time snapshot — for live data, point the user
at a BI tool. To revise, edit the file in place.
