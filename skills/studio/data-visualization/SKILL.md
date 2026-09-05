---
name: data-visualization
description: Create rigorous static or interactive data visualizations from real data. Use Python with matplotlib/seaborn for publication-ready PNG/SVG, or the JavaScript executor's embedded ECharts browser bundle for a self-contained interactive HTML chart.
---

# Data Visualization

Rigorous charts of a **real dataset**. Use Python (`matplotlib` / `seaborn`) for static output and the
JavaScript executor's `echartsSource` for interactive HTML. For an explanatory diagram or a quick
illustrative chart that _teaches a concept_, use `visualize`.

## Before you chart

Load the data into a pandas DataFrame (clean types and nulls). Note the **purpose & audience** — a chart
that states an insight to executives differs from one exploring a distribution. Save static charts as
**PNG/SVG** (`savefig(..., dpi=180, bbox_inches='tight')`). For interactive output, hand cleaned data
to `execute_javascript_code` through JSON and embed `echartsSource` in one HTML file. Saving the file
renders it in the side panel.

## Pick the chart — by what you're showing

| Showing                      | Chart                    | Alternatives                  |
| ---------------------------- | ------------------------ | ----------------------------- |
| trend over time              | line                     | area (cumulative)             |
| comparison across categories | bar (horizontal if many) | lollipop, dot plot            |
| ranking                      | horizontal bar           | slope (two periods)           |
| part-to-whole                | stacked bar              | treemap, waffle               |
| distribution                 | histogram                | box / violin (compare groups) |
| correlation (2 vars)         | scatter                  | bubble (3rd var → size)       |
| correlation (many vars)      | heatmap (corr matrix)    | pair plot                     |
| flow / drop-off              | sankey / funnel          |                               |
| many KPIs at once            | small multiples          |                               |

**Avoid:** pie and donut — humans misjudge angles; use bars (a donut only for a single KPI). **3D charts
— never** (they distort and add nothing). Dual-axis only with both axes clearly labelled (it implies a
correlation). **Bars always start at zero**; lines may use a non-zero baseline when the variation is the
point.

## Style setup

Do not ship an unchanged seaborn/matplotlib theme. Derive the figure field, ink, accent, comparison
color, typography, and annotation style from the subject or destination artifact. The example is a
working scaffold, not a palette to copy:

```python
import matplotlib.pyplot as plt, matplotlib.ticker as mticker, seaborn as sns
plt.rcParams.update({'figure.figsize': (10, 6), 'figure.dpi': 150, 'font.size': 11,
                     'axes.titlesize': 14, 'axes.titleweight': 'bold'})
FIELD, INK, MUTED = '#F7F8F5', '#17202A', '#68737D'
PALETTE = ['#176B87', '#EF7C45', '#665191', '#4DAA57']  # replace with brief-derived roles
```

A clean **ranked bar** — the pattern most charts follow (sort by value, label directly, drop chart junk,
insight title):

```python
d = df.sort_values('metric')
fig, ax = plt.subplots(facecolor=FIELD); ax.set_facecolor(FIELD)
bars = ax.barh(d['category'], d['metric'], color=PALETTE[0])
for b in bars:
    ax.text(b.get_width(), b.get_y() + b.get_height() / 2, f' {b.get_width():,.0f}', va='center', fontsize=10)
ax.set_title('Enterprise ACV grew 38% as mid-market stalled')        # the insight, not "Metric by category"
for s in ('top', 'right'):
    ax.spines[s].set_visible(False)
ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'{x / 1e3:.0f}K'))   # format big numbers
fig.tight_layout(); fig.savefig('chart.png', dpi=150, bbox_inches='tight'); plt.close(fig)
```

The others follow the same conventions: **line** → `ax.plot` per series + `fig.autofmt_xdate()`;
**histogram** → `ax.hist(bins=30)` with mean/median `axvline`; **heatmap** →
`sns.heatmap(df.pivot_table(...), annot=True, cmap='YlOrRd')`; **small multiples** →
`plt.subplots(rows, cols, sharex=True, sharey=True)`.

## Interactive → ECharts (offline)

Write the cleaned series to JSON in Python, then use `execute_javascript_code`:

```javascript
const rows = await vfs.readJSON("/chart-data.json");
const option = {
  tooltip: { trigger: "axis" },
  xAxis: { type: "category", data: rows.map((d) => d.date) },
  yAxis: { type: "value", name: "Revenue ($m)" },
  series: [{ type: "line", smooth: 0.25, data: rows.map((d) => d.value), lineStyle: { width: 3 } }],
};
const app = `const chart=echarts.init(document.getElementById('chart'));
chart.setOption(${JSON.stringify(option)});addEventListener('resize',()=>chart.resize());`;
const html = `<!doctype html><div id="chart" style="width:100%;height:520px"></div>
<script>${echartsSource}<\/script><script>${app}<\/script>`;
vfs.write("/chart.html", html, "text/html");
```

## Make it read well

- **Title states the insight** ("Revenue grew 23% YoY"), not the metric ("Revenue by month"). Subtitle
  carries the date range / source / filters.
- **Color encodes data, not decoration** — grey the context, one accent for the story; ≤ 6–8 categorical
  hues; prefer blue/orange to red/green (8% of men are red-green colorblind). Don't rely on color alone —
  label series directly, or differentiate with line styles/patterns so it survives black-and-white.
- **Cut chart junk** (gridlines, borders, backgrounds that carry nothing); sort by value unless there's a
  natural order (months, stages); data labels on key points only, not every bar.
- **Accuracy:** consistent scales across compared panels; show uncertainty (error bars / ranges) when the
  data is uncertain; don't rotate axis labels 90° if you can shorten or wrap them.

## Before sharing — checklist

- [ ] Title = the insight; axes labelled with units; legend clear and not over the data.
- [ ] Works without color (direct labels / line styles / patterns differentiate the series).
- [ ] Source and date range noted; text readable at standard zoom (≥ 10pt labels, ≥ 12pt titles).
