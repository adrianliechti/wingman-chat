---
name: build-dashboard
description: Build an interactive HTML dashboard with charts, filters, and tables. Use when creating an executive overview with KPI cards, turning query results into a shareable self-contained report, building a team monitoring snapshot, or needing multiple charts with filters in one browser-openable file.
---

# Build Dashboard build interactive dashboards

Build a self-contained interactive HTML dashboard with charts, filters, tables, and professional styling. Opens directly in a browser -- no server or dependencies required.

## Workflow

### 1. Understand the Dashboard Requirements

Determine:

- **Purpose**: Executive overview, operational monitoring, deep-dive analysis, team reporting
- **Audience**: Who will use this dashboard?
- **Key metrics**: What numbers matter most?
- **Dimensions**: What should users be able to filter or slice by?
- **Data source**: Live query, pasted data, CSV file, or sample data

### 2. Gather the Data

**If data warehouse is connected:**
1. Query the necessary data
2. Embed the results as JSON within the HTML file

**If data is pasted or uploaded:**
1. Parse and clean the data
2. Embed as JSON in the dashboard

**If working from a description without data:**
1. Create a realistic sample dataset matching the described schema
2. Note in the dashboard that it uses sample data
3. Provide instructions for swapping in real data

### 3. Design the Dashboard Layout

Follow a standard dashboard layout pattern:

```
┌──────────────────────────────────────────────────┐
│  Dashboard Title                    [Filters ▼]  │
├────────────┬────────────┬────────────┬───────────┤
│  KPI Card  │  KPI Card  │  KPI Card  │ KPI Card  │
├────────────┴────────────┼────────────┴───────────┤
│                         │                        │
│    Primary Chart        │   Secondary Chart      │
│    (largest area)       │                        │
│                         │                        │
├─────────────────────────┴────────────────────────┤
│                                                  │
│    Detail Table (sortable, scrollable)           │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Adapt the layout to the content:**
- 2-4 KPI cards at the top for headline numbers
- 1-3 charts in the middle section for trends and breakdowns
- Optional detail table at the bottom for drill-down data
- Filters in the header or sidebar depending on complexity

### 4. Build the HTML Dashboard

Generate a single self-contained HTML file using the base template below. The file includes:

**Structure (HTML):**
- Semantic HTML5 layout
- Responsive grid using CSS Grid or Flexbox
- Filter controls (dropdowns, date pickers, toggles)
- KPI cards with values and labels
- Chart containers
- Data table with sortable headers

**Styling (CSS):**
- Professional color scheme (clean whites, grays, with accent colors for data)
- Card-based layout with subtle shadows
- Consistent typography (system fonts for fast loading)
- Responsive design that works on different screen sizes
- Print-friendly styles

**Interactivity (JavaScript):**
- Inline SVG charts drawn with vanilla JS — **no library, no CDN, fully offline**
- Filter dropdowns that update all charts and tables simultaneously
- Sortable table columns
- Hover tooltips on charts
- Number formatting (commas, currency, percentages)

**Data (embedded JSON):**
- All data embedded directly in the HTML as JavaScript variables
- No external data fetches required
- Dashboard works completely offline

### 5. Implement Chart Types

Draw charts as **inline SVG** with the small vanilla-JS helpers below — no library, no network, so the
file works offline. Each helper renders into a `<div>` and is re-callable to redraw on filter change.

- **Line chart**: Time series trends
- **Bar chart**: Category comparisons
- **Doughnut chart**: Composition (when <6 categories)

Use the inline-SVG patterns below for each chart type. (For very dense statistical charts, render a
PNG with the Python interpreter — `matplotlib` — and embed it as a base64 `data:` URI instead.)

### 6. Add Interactivity

Use the filter and interactivity implementation patterns below for dropdown filters, date range filters, combined filter logic, sortable tables, and chart updates.

### 7. Save and Open

1. Save the dashboard as an HTML file with a descriptive name (e.g., `sales_dashboard.html`)
2. Open it in the user's default browser
3. Confirm it renders correctly
4. Provide instructions for updating data or customizing

---

## Base Template

Every dashboard follows this structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard Title</title>
    <style>
        /* Dashboard styles go here */
    </style>
</head>
<body>
    <div class="dashboard-container">
        <header class="dashboard-header">
            <h1>Dashboard Title</h1>
            <div class="filters">
                <!-- Filter controls -->
            </div>
        </header>

        <section class="kpi-row">
            <!-- KPI cards -->
        </section>

        <section class="chart-row">
            <!-- Chart containers -->
        </section>

        <section class="table-section">
            <!-- Data table -->
        </section>

        <footer class="dashboard-footer">
            <span>Data as of: <span id="data-date"></span></span>
        </footer>
    </div>

    <script>
        // Embedded data
        const DATA = [];

        // Dashboard logic
        class Dashboard {
            constructor(data) {
                this.rawData = data;
                this.filteredData = data;
                this.charts = {};
                this.init();
            }

            init() {
                this.setupFilters();
                this.renderKPIs();
                this.renderCharts();
                this.renderTable();
            }

            applyFilters() {
                // Filter logic
                this.filteredData = this.rawData.filter(row => {
                    // Apply each active filter
                    return true; // placeholder
                });
                this.renderKPIs();
                this.updateCharts();
                this.renderTable();
            }

            // ... methods for each section
        }

        const dashboard = new Dashboard(DATA);
    </script>
</body>
</html>
```

## KPI Card Pattern

```html
<div class="kpi-card">
    <div class="kpi-label">Total Revenue</div>
    <div class="kpi-value" id="kpi-revenue">$0</div>
    <div class="kpi-change positive" id="kpi-revenue-change">+0%</div>
</div>
```

```javascript
function renderKPI(elementId, value, previousValue, format = 'number') {
    const el = document.getElementById(elementId);
    const changeEl = document.getElementById(elementId + '-change');

    // Format the value
    el.textContent = formatValue(value, format);

    // Calculate and display change
    if (previousValue && previousValue !== 0) {
        const pctChange = ((value - previousValue) / previousValue) * 100;
        const sign = pctChange >= 0 ? '+' : '';
        changeEl.textContent = `${sign}${pctChange.toFixed(1)}% vs prior period`;
        changeEl.className = `kpi-change ${pctChange >= 0 ? 'positive' : 'negative'}`;
    }
}

function formatValue(value, format) {
    switch (format) {
        case 'currency':
            if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
            if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
            return `$${value.toFixed(0)}`;
        case 'percent':
            return `${value.toFixed(1)}%`;
        case 'number':
            if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
            if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
            return value.toLocaleString();
        default:
            return value.toString();
    }
}
```

## Inline SVG Charts (no dependencies)

All charts are drawn as inline SVG with plain JavaScript — no Chart.js, no CDN — so the file renders
**offline**. Each helper renders into a `<div>` (not a `<canvas>`) and is **idempotent**: call it again
with filtered data to redraw. `formatValue` (defined above) formats axis labels; native `<title>`
elements give hover tooltips for free.

### Chart Container Pattern

```html
<div class="chart-container">
    <h3 class="chart-title">Monthly Revenue Trend</h3>
    <div id="revenue-chart" class="chart"></div>
</div>
```

```javascript
const CHART_COLORS = ['#4C72B0', '#DD8452', '#55A868', '#C44E52', '#8172B3', '#937860'];
```

### Bar Chart

```javascript
function renderBarChart(elId, labels, values, opts = {}) {
    const W = 600, H = 320, P = { l: 52, r: 16, t: 12, b: 44 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const max = Math.max(1, ...values), bw = iw / Math.max(1, labels.length);
    let g = '';                                            // gridlines + y-axis labels
    for (let i = 0; i <= 4; i++) {
        const y = P.t + ih - (ih * i) / 4;
        g += `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="#e9ecef"/>`
           + `<text x="${P.l - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6c757d">${formatValue((max * i) / 4, opts.format || 'number')}</text>`;
    }
    let bars = '';
    values.forEach((v, i) => {
        const h = ih * (v / max), x = P.l + bw * i + bw * 0.15, w = bw * 0.7, y = P.t + ih - h;
        bars += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${opts.color || CHART_COLORS[0]}"><title>${labels[i]}: ${formatValue(v, opts.format || 'number')}</title></rect>`
              + `<text x="${x + w / 2}" y="${H - P.b + 16}" text-anchor="middle" font-size="11" fill="#6c757d">${labels[i]}</text>`;
    });
    document.getElementById(elId).innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="bar chart">${g}${bars}</svg>`;
}
```

### Line Chart

```javascript
function renderLineChart(elId, labels, series, opts = {}) {
    // series: [{ label, data: [...] }, ...]
    const W = 600, H = 320, P = { l: 52, r: 16, t: 12, b: 44 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const max = Math.max(1, ...series.flatMap((s) => s.data));
    const X = (i) => P.l + (iw * i) / Math.max(1, labels.length - 1);
    const Y = (v) => P.t + ih - ih * (v / max);
    let g = '';
    for (let i = 0; i <= 4; i++) {
        const y = P.t + ih - (ih * i) / 4;
        g += `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="#e9ecef"/>`
           + `<text x="${P.l - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6c757d">${formatValue((max * i) / 4, opts.format || 'number')}</text>`;
    }
    let lines = '';
    series.forEach((s, si) => {
        const c = CHART_COLORS[si % CHART_COLORS.length];
        lines += `<polyline points="${s.data.map((v, i) => `${X(i)},${Y(v)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2"/>`
               + s.data.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="${c}"><title>${labels[i]}: ${formatValue(v, opts.format || 'number')}</title></circle>`).join('');
    });
    const xl = labels.map((l, i) => `<text x="${X(i)}" y="${H - P.b + 16}" text-anchor="middle" font-size="11" fill="#6c757d">${l}</text>`).join('');
    document.getElementById(elId).innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="line chart">${g}${lines}${xl}</svg>`;
}
```

### Doughnut Chart

```javascript
function renderDoughnutChart(elId, labels, values) {
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const R = 70, C = 2 * Math.PI * R, cx = 90, cy = 90;
    let off = 0, segs = '', legend = '';
    values.forEach((v, i) => {
        const len = C * (v / total), c = CHART_COLORS[i % CHART_COLORS.length];
        segs += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${c}" stroke-width="28" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})"><title>${labels[i]}: ${formatValue(v, 'number')} (${((100 * v) / total).toFixed(1)}%)</title></circle>`;
        legend += `<div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0"><span style="width:10px;height:10px;border-radius:2px;background:${c};display:inline-block"></span>${labels[i]} — ${formatValue(v, 'number')}</div>`;
        off += len;
    });
    document.getElementById(elId).innerHTML =
        `<div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;justify-content:center"><svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="doughnut chart">${segs}</svg><div>${legend}</div></div>`;
}
```

### Updating Charts on Filter Change

The helpers are idempotent — recompute the arrays from `this.filteredData` and call the same `render*`
function again. (No diffing, no animation state to manage — replacing `innerHTML` is instant.)

```javascript
updateCharts() {
    // months / monthlyRevenue / categories / categoryTotals derived from this.filteredData
    renderLineChart('revenue-chart', months, [{ label: 'Revenue', data: monthlyRevenue }], { format: 'currency' });
    renderBarChart('category-chart', categories, categoryTotals, { format: 'currency' });
}
```

## Filter and Interactivity Implementation

### Dropdown Filter

```html
<div class="filter-group">
    <label for="filter-region">Region</label>
    <select id="filter-region" onchange="dashboard.applyFilters()">
        <option value="all">All Regions</option>
    </select>
</div>
```

```javascript
function populateFilter(selectId, data, field) {
    const select = document.getElementById(selectId);
    const values = [...new Set(data.map(d => d[field]))].sort();

    // Keep the "All" option, add unique values
    values.forEach(val => {
        const option = document.createElement('option');
        option.value = val;
        option.textContent = val;
        select.appendChild(option);
    });
}

function getFilterValue(selectId) {
    const val = document.getElementById(selectId).value;
    return val === 'all' ? null : val;
}
```

### Date Range Filter

```html
<div class="filter-group">
    <label>Date Range</label>
    <input type="date" id="filter-date-start" onchange="dashboard.applyFilters()">
    <span>to</span>
    <input type="date" id="filter-date-end" onchange="dashboard.applyFilters()">
</div>
```

```javascript
function filterByDateRange(data, dateField, startDate, endDate) {
    return data.filter(row => {
        const rowDate = new Date(row[dateField]);
        if (startDate && rowDate < new Date(startDate)) return false;
        if (endDate && rowDate > new Date(endDate)) return false;
        return true;
    });
}
```

### Combined Filter Logic

```javascript
applyFilters() {
    const region = getFilterValue('filter-region');
    const category = getFilterValue('filter-category');
    const startDate = document.getElementById('filter-date-start').value;
    const endDate = document.getElementById('filter-date-end').value;

    this.filteredData = this.rawData.filter(row => {
        if (region && row.region !== region) return false;
        if (category && row.category !== category) return false;
        if (startDate && row.date < startDate) return false;
        if (endDate && row.date > endDate) return false;
        return true;
    });

    this.renderKPIs();
    this.updateCharts();
    this.renderTable();
}
```

### Sortable Table

```javascript
function renderTable(containerId, data, columns) {
    const container = document.getElementById(containerId);
    let sortCol = null;
    let sortDir = 'desc';

    function render(sortedData) {
        let html = '<table class="data-table">';

        // Header
        html += '<thead><tr>';
        columns.forEach(col => {
            const arrow = sortCol === col.field
                ? (sortDir === 'asc' ? ' ▲' : ' ▼')
                : '';
            html += `<th onclick="sortTable('${col.field}')" style="cursor:pointer">${col.label}${arrow}</th>`;
        });
        html += '</tr></thead>';

        // Body
        html += '<tbody>';
        sortedData.forEach(row => {
            html += '<tr>';
            columns.forEach(col => {
                const value = col.format ? formatValue(row[col.field], col.format) : row[col.field];
                html += `<td>${value}</td>`;
            });
            html += '</tr>';
        });
        html += '</tbody></table>';

        container.innerHTML = html;
    }

    window.sortTable = function(field) {
        if (sortCol === field) {
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            sortCol = field;
            sortDir = 'desc';
        }
        const sorted = [...data].sort((a, b) => {
            const aVal = a[field], bVal = b[field];
            const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return sortDir === 'asc' ? cmp : -cmp;
        });
        render(sorted);
    };

    render(data);
}
```

## CSS Styling for Dashboards

### Color System

```css
:root {
    /* Background layers */
    --bg-primary: #f8f9fa;
    --bg-card: #ffffff;
    --bg-header: #1a1a2e;

    /* Text */
    --text-primary: #212529;
    --text-secondary: #6c757d;
    --text-on-dark: #ffffff;

    /* Accent colors for data */
    --color-1: #4C72B0;
    --color-2: #DD8452;
    --color-3: #55A868;
    --color-4: #C44E52;
    --color-5: #8172B3;
    --color-6: #937860;

    /* Status colors */
    --positive: #28a745;
    --negative: #dc3545;
    --neutral: #6c757d;

    /* Spacing */
    --gap: 16px;
    --radius: 8px;
}
```

### Layout

```css
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.5;
}

.dashboard-container {
    max-width: 1400px;
    margin: 0 auto;
    padding: var(--gap);
}

.dashboard-header {
    background: var(--bg-header);
    color: var(--text-on-dark);
    padding: 20px 24px;
    border-radius: var(--radius);
    margin-bottom: var(--gap);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
}

.dashboard-header h1 {
    font-size: 20px;
    font-weight: 600;
}
```

### KPI Cards

```css
.kpi-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--gap);
    margin-bottom: var(--gap);
}

.kpi-card {
    background: var(--bg-card);
    border-radius: var(--radius);
    padding: 20px 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.kpi-label {
    font-size: 13px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
}

.kpi-value {
    font-size: 28px;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 4px;
}

.kpi-change {
    font-size: 13px;
    font-weight: 500;
}

.kpi-change.positive { color: var(--positive); }
.kpi-change.negative { color: var(--negative); }
```

### Chart Containers

```css
.chart-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
    gap: var(--gap);
    margin-bottom: var(--gap);
}

.chart-container {
    background: var(--bg-card);
    border-radius: var(--radius);
    padding: 20px 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.chart-container h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 16px;
}

.chart-container .chart svg {
    width: 100%;
    height: auto;
    display: block;
}
```

### Filters

```css
.filters {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
}

.filter-group {
    display: flex;
    align-items: center;
    gap: 6px;
}

.filter-group label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
}

.filter-group select,
.filter-group input[type="date"] {
    padding: 6px 10px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-on-dark);
    font-size: 13px;
}

.filter-group select option {
    background: var(--bg-header);
    color: var(--text-on-dark);
}
```

### Data Table

```css
.table-section {
    background: var(--bg-card);
    border-radius: var(--radius);
    padding: 20px 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    overflow-x: auto;
}

.data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}

.data-table thead th {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 2px solid #dee2e6;
    color: var(--text-secondary);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
    user-select: none;
}

.data-table thead th:hover {
    color: var(--text-primary);
    background: #f8f9fa;
}

.data-table tbody td {
    padding: 10px 12px;
    border-bottom: 1px solid #f0f0f0;
}

.data-table tbody tr:hover {
    background: #f8f9fa;
}

.data-table tbody tr:last-child td {
    border-bottom: none;
}
```

### Responsive Design

```css
@media (max-width: 768px) {
    .dashboard-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .kpi-row {
        grid-template-columns: repeat(2, 1fr);
    }

    .chart-row {
        grid-template-columns: 1fr;
    }

    .filters {
        flex-direction: column;
        align-items: flex-start;
    }
}

@media print {
    body { background: white; }
    .dashboard-container { max-width: none; }
    .filters { display: none; }
    .chart-container { break-inside: avoid; }
    .kpi-card { border: 1px solid #dee2e6; box-shadow: none; }
}
```

## Performance Considerations for Large Datasets

### Data Size Guidelines

| Data Size | Approach |
|---|---|
| <1,000 rows | Embed directly in HTML. Full interactivity. |
| 1,000 - 10,000 rows | Embed in HTML. May need to pre-aggregate for charts. |
| 10,000 - 100,000 rows | Pre-aggregate server-side. Embed only aggregated data. |
| >100,000 rows | Not suitable for client-side dashboard. Use a BI tool or paginate. |

### Pre-Aggregation Pattern

Instead of embedding raw data and aggregating in the browser:

```javascript
// DON'T: embed 50,000 raw rows
const RAW_DATA = [/* 50,000 rows */];

// DO: pre-aggregate before embedding
const CHART_DATA = {
    monthly_revenue: [
        { month: '2024-01', revenue: 150000, orders: 1200 },
        { month: '2024-02', revenue: 165000, orders: 1350 },
        // ... 12 rows instead of 50,000
    ],
    top_products: [
        { product: 'Widget A', revenue: 45000 },
        // ... 10 rows
    ],
    kpis: {
        total_revenue: 1980000,
        total_orders: 15600,
        avg_order_value: 127,
    }
};
```

### Chart Performance

- Limit line charts to <500 data points per series (downsample if needed) — an SVG `<polyline>` with
  thousands of points gets sluggish.
- Limit bar charts to <50 categories; for many categories, switch to a horizontal layout or a table.
- Redrawing replaces the chart's `innerHTML` — already instant, with no animation state to manage.
- For very dense statistical charts, render a PNG with the Python interpreter (`matplotlib`) and embed
  it as a base64 `data:` URI rather than drawing thousands of SVG nodes.

### DOM Performance

- Limit data tables to 100-200 visible rows. Add pagination for more.
- Use `requestAnimationFrame` for coordinated chart updates
- Avoid rebuilding the entire DOM on filter change -- update only changed elements

```javascript
// Efficient table pagination
function renderTablePage(data, page, pageSize = 50) {
    const start = page * pageSize;
    const end = Math.min(start + pageSize, data.length);
    const pageData = data.slice(start, end);
    // Render only pageData
    // Show pagination controls: "Showing 1-50 of 2,340"
}
```

## Examples

## Tips

- Dashboards are fully self-contained HTML files -- share them with anyone by sending the file
- For real-time dashboards, consider connecting to a BI tool instead. These dashboards are point-in-time snapshots
- Request "dark mode" or "presentation mode" for different styling
- You can request a specific color scheme to match your brand
