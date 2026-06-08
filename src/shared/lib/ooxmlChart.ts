import { child, descend, escapeHtml } from "./ooxml";

/**
 * Shared DrawingML chart renderer (c:chartSpace) used by both pptx and xlsx.
 * Parses the cached series data and draws column/bar/line/area/pie/doughnut
 * charts as inline SVG. Series colors are resolved via a caller-supplied
 * `FillResolver` (each host app resolves theme/scheme colors differently),
 * falling back to the theme accent palette.
 */

export interface ChartSeries {
  name: string;
  color: string;
  values: number[];
  ptColors?: (string | undefined)[];
}

export interface ChartData {
  type: string; // barChart | lineChart | pieChart | doughnutChart | areaChart
  barDir: string; // bar (horizontal) | col (vertical)
  grouping: string; // clustered | stacked | percentStacked | standard
  categories: string[];
  series: ChartSeries[];
  title?: string;
}

/** Resolve a chart element's `c:spPr` to a CSS fill color (or undefined). */
export type FillResolver = (spPr: Element | undefined) => string | undefined;

/** All descendants matching a local name (namespace-agnostic), for chart XML. */
function els(parent: Element | undefined | null, localName: string): Element[] {
  if (!parent) return [];
  return Array.from(parent.getElementsByTagNameNS("*", localName));
}

/** Collect cached point values (c:strCache / c:numCache) from a c:cat or c:val. */
function chartCachePts(parent: Element | undefined): string[] {
  if (!parent) return [];
  const arr: string[] = [];
  let max = -1;
  for (const pt of els(parent, "pt")) {
    const idx = parseInt(pt.getAttribute("idx") || "0", 10);
    arr[idx] = els(pt, "v")[0]?.textContent ?? "";
    if (idx > max) max = idx;
  }
  const out: string[] = [];
  for (let i = 0; i <= max; i++) out.push(arr[i] ?? "");
  return out;
}

function chartTitle(doc: Document): string | undefined {
  const title = descend(doc.documentElement, "c:chart", "c:title");
  if (!title) return undefined;
  const t = els(title, "t")
    .map((n) => n.textContent ?? "")
    .join("")
    .trim();
  return t || undefined;
}

export function parseChart(
  doc: Document,
  resolveFill: FillResolver,
  accents: (string | undefined)[],
): ChartData | null {
  const plotArea = descend(doc.documentElement, "c:chart", "c:plotArea");
  if (!plotArea) return null;
  const TYPES = ["c:barChart", "c:lineChart", "c:pieChart", "c:doughnutChart", "c:areaChart"];
  let typeEl: Element | undefined;
  let type = "";
  for (const t of TYPES) {
    const e = child(plotArea, t);
    if (e) {
      typeEl = e;
      type = t.slice(2);
      break;
    }
  }
  if (!typeEl) return null;

  const barDir = child(typeEl, "c:barDir")?.getAttribute("val") || "col";
  const grouping = child(typeEl, "c:grouping")?.getAttribute("val") || "clustered";

  let categories: string[] = [];
  const series: ChartSeries[] = [];
  els(typeEl, "ser").forEach((ser, si) => {
    const name = els(child(ser, "c:tx"), "v")[0]?.textContent || `Series ${si + 1}`;
    const values = chartCachePts(child(ser, "c:val")).map((v) => {
      const n = parseFloat(v);
      return Number.isNaN(n) ? 0 : n;
    });
    const cats = chartCachePts(child(ser, "c:cat"));
    if (cats.length > categories.length) categories = cats;
    const color = resolveFill(child(ser, "c:spPr")) || accents[si % 6] || "#4472C4";
    // Per-point colors (pie/doughnut slices)
    const ptColors: (string | undefined)[] = [];
    for (const dPt of els(ser, "dPt")) {
      const idx = parseInt(els(dPt, "idx")[0]?.getAttribute("val") || "0", 10);
      ptColors[idx] = resolveFill(child(dPt, "c:spPr"));
    }
    series.push({ name, color, values, ptColors: ptColors.length ? ptColors : undefined });
  });

  return { type, barDir, grouping, categories, series, title: chartTitle(doc) };
}

function chartNiceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  const f = v / base;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * base;
}

function chartFmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const PIE_PALETTE = ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#264478", "#9E480E"];

function sliceColor(ser: ChartSeries | undefined, i: number): string {
  return ser?.ptColors?.[i] || PIE_PALETTE[i % PIE_PALETTE.length] || ser?.color || "#4472C4";
}

/** Render the chart as a standalone `<svg>` string sized to W×H px. */
export function renderChartSvg(data: ChartData, width: number, height: number): string {
  const W = Math.max(width, 60);
  const H = Math.max(height, 40);
  const isPie = data.type === "pieChart" || data.type === "doughnutChart";
  const stacked = data.grouping === "stacked" || data.grouping === "percentStacked";
  const e = escapeHtml;
  const svg: string[] = [];

  let top = 6;
  if (data.title) {
    svg.push(
      `<text x="${W / 2}" y="${top + 11}" text-anchor="middle" font-size="13" font-weight="bold" fill="#444">${e(data.title)}</text>`,
    );
    top += 22;
  }

  const legendItems = isPie
    ? data.categories.map((c, i) => ({ label: c || `Item ${i + 1}`, color: sliceColor(data.series[0], i) }))
    : data.series.map((s) => ({ label: s.name, color: s.color }));
  const showLegend = legendItems.length > 1;
  const legendH = showLegend ? 18 : 4;
  const bottom = H - legendH;
  if (showLegend) {
    let lx = 8;
    const ly = H - 6;
    for (const it of legendItems) {
      const tw = Math.min(it.label.length * 6 + 16, 130);
      if (lx + tw > W - 4) break;
      svg.push(`<rect x="${lx}" y="${ly - 8}" width="8" height="8" fill="${it.color}"/>`);
      svg.push(`<text x="${lx + 11}" y="${ly}" font-size="10" fill="#555">${e(truncate(it.label, 18))}</text>`);
      lx += tw;
    }
  }

  if (isPie) svg.push(renderPie(data, W, top, bottom));
  else svg.push(renderCartesian(data, W, top, bottom, stacked));

  return `<svg width="100%" height="100%" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}" preserveAspectRatio="none" font-family="inherit">${svg.join("")}</svg>`;
}

function renderCartesian(data: ChartData, W: number, top: number, bottom: number, stacked: boolean): string {
  const gutterL = 40;
  const gutterB = 18;
  const plotX = gutterL;
  const plotY = top;
  const plotW = Math.max(W - gutterL - 8, 10);
  const plotH = Math.max(bottom - top - gutterB, 10);
  const horiz = data.type === "barChart" && data.barDir === "bar";
  const nCat = data.categories.length || Math.max(...data.series.map((s) => s.values.length), 1);

  let dataMax = 0;
  let dataMin = 0;
  for (let c = 0; c < nCat; c++) {
    if (stacked) {
      let pos = 0;
      let neg = 0;
      for (const s of data.series) {
        const v = s.values[c] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      dataMax = Math.max(dataMax, pos);
      dataMin = Math.min(dataMin, neg);
    } else {
      for (const s of data.series) {
        dataMax = Math.max(dataMax, s.values[c] ?? 0);
        dataMin = Math.min(dataMin, s.values[c] ?? 0);
      }
    }
  }
  const axMax = chartNiceMax(dataMax) || 1;
  const axMin = dataMin < 0 ? -chartNiceMax(-dataMin) : 0;
  const range = axMax - axMin || 1;

  const out: string[] = [];
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const val = axMin + (range * t) / ticks;
    if (horiz) {
      const x = plotX + (plotW * (val - axMin)) / range;
      out.push(`<line x1="${x}" y1="${plotY}" x2="${x}" y2="${plotY + plotH}" stroke="#E6E6E6"/>`);
      out.push(
        `<text x="${x}" y="${plotY + plotH + 12}" text-anchor="middle" font-size="9" fill="#888">${escapeHtml(chartFmt(val))}</text>`,
      );
    } else {
      const y = plotY + plotH - (plotH * (val - axMin)) / range;
      out.push(`<line x1="${plotX}" y1="${y}" x2="${plotX + plotW}" y2="${y}" stroke="#E6E6E6"/>`);
      out.push(
        `<text x="${plotX - 4}" y="${y + 3}" text-anchor="end" font-size="9" fill="#888">${escapeHtml(chartFmt(val))}</text>`,
      );
    }
  }

  const catSpan = (horiz ? plotH : plotW) / nCat;
  const nSer = data.series.length;
  const zero = horiz ? plotX + (plotW * (0 - axMin)) / range : plotY + plotH - (plotH * (0 - axMin)) / range;

  if (data.type === "lineChart" || data.type === "areaChart") {
    data.series.forEach((s) => {
      const pts: string[] = [];
      for (let c = 0; c < nCat; c++) {
        const cx = plotX + catSpan * (c + 0.5);
        const cy = plotY + plotH - (plotH * ((s.values[c] ?? 0) - axMin)) / range;
        pts.push(`${cx},${cy}`);
      }
      if (data.type === "areaChart") {
        const area = `${plotX},${zero} ${pts.join(" ")} ${plotX + catSpan * (nCat - 0.5)},${zero}`;
        out.push(`<polygon points="${area}" fill="${s.color}" fill-opacity="0.45"/>`);
      }
      out.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2"/>`);
    });
  } else {
    const groupPad = catSpan * 0.15;
    const innerW = catSpan - groupPad * 2;
    const barW = stacked ? innerW : innerW / Math.max(nSer, 1);
    const valToX = (val: number) => plotX + (plotW * (val - axMin)) / range;
    const valToY = (val: number) => plotY + plotH - (plotH * (val - axMin)) / range;
    for (let c = 0; c < nCat; c++) {
      const groupStart = (horiz ? plotY : plotX) + catSpan * c + groupPad;
      let posAcc = 0;
      let negAcc = 0;
      data.series.forEach((s, si) => {
        const v = s.values[c] ?? 0;
        if (v === 0) return;
        const color = s.ptColors?.[c] || s.color;
        const thick = Math.max(barW - 1, 1);
        if (horiz) {
          const y = groupStart + (stacked ? 0 : barW * si);
          let a: number;
          let b: number;
          if (stacked) {
            if (v >= 0) {
              a = valToX(posAcc);
              b = valToX(posAcc + v);
              posAcc += v;
            } else {
              a = valToX(negAcc);
              b = valToX(negAcc + v);
              negAcc += v;
            }
          } else {
            a = valToX(Math.min(0, v));
            b = valToX(Math.max(0, v));
          }
          out.push(
            `<rect x="${Math.min(a, b).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.abs(b - a).toFixed(1)}" height="${thick.toFixed(1)}" fill="${color}"/>`,
          );
        } else {
          const x = groupStart + (stacked ? 0 : barW * si);
          let a: number;
          let b: number;
          if (stacked) {
            if (v >= 0) {
              a = valToY(posAcc);
              b = valToY(posAcc + v);
              posAcc += v;
            } else {
              a = valToY(negAcc);
              b = valToY(negAcc + v);
              negAcc += v;
            }
          } else {
            a = valToY(Math.max(0, v));
            b = valToY(Math.min(0, v));
          }
          out.push(
            `<rect x="${x.toFixed(1)}" y="${Math.min(a, b).toFixed(1)}" width="${thick.toFixed(1)}" height="${Math.abs(b - a).toFixed(1)}" fill="${color}"/>`,
          );
        }
      });
    }
  }

  for (let c = 0; c < nCat; c++) {
    const label = data.categories[c];
    if (!label) continue;
    if (horiz) {
      const y = plotY + catSpan * (c + 0.5) + 3;
      out.push(
        `<text x="${plotX - 4}" y="${y}" text-anchor="end" font-size="9" fill="#888">${escapeHtml(truncate(label, 10))}</text>`,
      );
    } else {
      const x = plotX + catSpan * (c + 0.5);
      out.push(
        `<text x="${x}" y="${plotY + plotH + 12}" text-anchor="middle" font-size="9" fill="#888">${escapeHtml(truncate(label, 10))}</text>`,
      );
    }
  }

  out.push(`<line x1="${plotX}" y1="${plotY + plotH}" x2="${plotX + plotW}" y2="${plotY + plotH}" stroke="#B0B0B0"/>`);
  return out.join("");
}

function renderPie(data: ChartData, W: number, top: number, bottom: number): string {
  const ser = data.series[0];
  if (!ser) return "";
  const cx = W / 2;
  const cy = (top + bottom) / 2;
  const r = Math.max(Math.min(W, bottom - top) / 2 - 6, 6);
  const total = ser.values.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
  let a0 = -Math.PI / 2;
  const out: string[] = [];
  ser.values.forEach((v, i) => {
    if (v <= 0) return;
    const a1 = a0 + (Math.max(v, 0) / total) * Math.PI * 2;
    const p = (a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    out.push(
      `<path d="M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z" fill="${sliceColor(ser, i)}"/>`,
    );
    a0 = a1;
  });
  if (data.type === "doughnutChart") {
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#fff"/>`);
  }
  return out.join("");
}
