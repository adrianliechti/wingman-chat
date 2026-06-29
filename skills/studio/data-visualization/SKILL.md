---
name: data-visualization
description: Create effective data visualizations with Python (matplotlib, seaborn, plotly). Use when turning query results or a DataFrame into a chart, choosing the right chart type for a trend / comparison / distribution, creating publication-quality figures for a report or presentation, building an interactive chart with hover and zoom, or applying design principles like accessibility and color theory.
---

# Data Visualization

Rigorous charts of a **real dataset** with Python (`matplotlib` / `seaborn`; `plotly` for interactive).
For an explanatory diagram or a quick illustrative chart that *teaches a concept*, use `visualize`.

## Before you chart

Load the data into a pandas DataFrame (clean types and nulls). Note the **purpose & audience** — a chart
that states an insight to executives differs from one exploring a distribution. Save static charts as
**PNG** (`savefig(..., dpi=150, bbox_inches='tight')`) and interactive ones as a self-contained **HTML**
(`write_html(..., include_plotlyjs=True)` — offline; the default `'cdn'` fetches ~3.5MB at view time).
Saving the file renders it in the side panel.

## Pick the chart — by what you're showing

| Showing | Chart | Alternatives |
|---|---|---|
| trend over time | line | area (cumulative) |
| comparison across categories | bar (horizontal if many) | lollipop, dot plot |
| ranking | horizontal bar | slope (two periods) |
| part-to-whole | stacked bar | treemap, waffle |
| distribution | histogram | box / violin (compare groups) |
| correlation (2 vars) | scatter | bubble (3rd var → size) |
| correlation (many vars) | heatmap (corr matrix) | pair plot |
| flow / drop-off | sankey / funnel | |
| many KPIs at once | small multiples | |

**Avoid:** pie and donut — humans misjudge angles; use bars (a donut only for a single KPI). **3D charts
— never** (they distort and add nothing). Dual-axis only with both axes clearly labelled (it implies a
correlation). **Bars always start at zero**; lines may use a non-zero baseline when the variation is the
point.

## Style setup (consistent defaults)

```python
import matplotlib.pyplot as plt, matplotlib.ticker as mticker, seaborn as sns
plt.style.use('seaborn-v0_8-whitegrid')
plt.rcParams.update({'figure.figsize': (10, 6), 'figure.dpi': 150, 'font.size': 11,
                     'axes.titlesize': 14, 'axes.titleweight': 'bold'})
PALETTE = ['#4C72B0', '#DD8452', '#55A868', '#C44E52', '#8172B3', '#937860']  # distinct, colorblind-safe hues
```

A clean **ranked bar** — the pattern most charts follow (sort by value, label directly, drop chart junk,
insight title):

```python
d = df.sort_values('metric')
fig, ax = plt.subplots()
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

## Interactive → Plotly (offline)

```python
import plotly.express as px
fig = px.line(df, x='date', y='value', color='category', title='Metric trend')
fig.update_layout(hovermode='x unified')
fig.write_html('chart.html', include_plotlyjs=True)   # INLINES plotly.js → works offline
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
