import { areaY, barX, barY, defineChart, dot, group, lineY, ruleY, stack } from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { Chart } from "@tanstack/charts/react/tooltip";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import type { ChartDefinition } from "@tanstack/charts/react";
import { useMemo } from "react";
import { formatValue, stringify } from "@/shared/lib/intelligentUi/expression";
import { useTheme } from "@/shell/hooks/useTheme";

export interface UiChartProps {
  kind: "line" | "area" | "bar" | "pie" | "donut" | "scatter";
  data: unknown;
  x?: string;
  y?: string;
  series?: (string | { key: string; label?: string })[];
  title?: string;
  stacked?: boolean;
  horizontal?: boolean;
  height?: number;
  format?: string;
  currency?: string;
  xLabel?: string;
  yLabel?: string;
}

// Categorical slots in fixed order (never cycled), stepped for each surface.
const LIGHT_SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const DARK_SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const MAX_SERIES = LIGHT_SERIES.length;
const MAX_POINTS = 2_000;

type Row = Record<string, unknown>;
type Series = { key: string; label?: string };
/** One mark datum: wide rows are folded so every series is a colour value. */
type Point = { x: string | number; series: string; value: number | null };

function rows(data: unknown): Row[] {
  if (!Array.isArray(data)) return [];
  return data.slice(0, MAX_POINTS).map((row, index): Row => {
    if (row && typeof row === "object" && !Array.isArray(row)) return row as Row;
    if (Array.isArray(row)) return { x: row[0], y: row[1] };
    return { x: index, y: row };
  });
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isNumericColumn(data: Row[], key: string): boolean {
  return data.length > 0 && data.every((row) => numeric(row[key]) !== null);
}

interface Model {
  data: Row[];
  xKey: string;
  xNumeric: boolean;
  series: Series[];
  points: Point[];
}

interface LegendItem {
  label: string;
  color: string;
  detail?: string;
}

/**
 * The legend is plain HTML under the chart rather than the chart's own: it
 * wraps on narrow widths, never competes with a pie for height, and can carry
 * a slice's share. Colours follow the explicit domain order given to the chart.
 */
function Legend({ items }: { items: LegendItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} aria-hidden />
          <span className="text-neutral-800 dark:text-neutral-200">{item.label}</span>
          {item.detail && <span className="tabular-nums">{item.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

function buildModel(props: UiChartProps): Model {
  const data = rows(props.data);
  const keys = data.length ? Object.keys(data[0]) : [];
  // The category axis: the declared `x`, else the first non-numeric column, else the first column.
  const xKey = props.x ?? keys.find((key) => !isNumericColumn(data, key)) ?? keys[0] ?? "x";
  const declared: Series[] =
    props.series?.map((s) => (typeof s === "string" ? { key: s } : s)) ?? (props.y ? [{ key: props.y }] : []);
  const inferred: Series[] = keys.filter((key) => key !== xKey && isNumericColumn(data, key)).map((key) => ({ key }));
  const series: Series[] = (declared.length ? declared : inferred).slice(0, MAX_SERIES);
  const xNumeric = props.kind === "scatter" ? isNumericColumn(data, xKey) : false;
  const points = data.flatMap((row) =>
    series.map((s) => ({
      x: xNumeric ? (numeric(row[xKey]) ?? 0) : stringify(row[xKey]),
      series: s.label ?? s.key,
      value: numeric(row[s.key]),
    })),
  );
  return { data, xKey, xNumeric, series, points };
}

/** The branches build definitions over different datum types; the host component accepts any of them. */
function define(definition: unknown): ChartDefinition {
  return definition as ChartDefinition;
}

export function UiChart(props: UiChartProps) {
  const { isDark } = useTheme();
  const height = Math.max(120, Math.min(600, props.height ?? 260));
  const model = useMemo(() => buildModel(props), [props]);
  const empty = model.points.length === 0;

  // A new definition identity rebuilds the scene; everything the chart reads is a dependency.
  const chart = useMemo((): { definition: ChartDefinition; legend: LegendItem[] } | null => {
    if (empty) return null;
    const palette = isDark ? DARK_SERIES : LIGHT_SERIES;
    const theme = {
      foreground: isDark ? "#c3c2b7" : "#52514e",
      muted: isDark ? "#8a8984" : "#7a7975",
      grid: isDark ? "#2e2e2d" : "#e8e8e6",
      background: "transparent",
      palette,
    };
    const fmt = (value: unknown) =>
      props.format && props.format !== "text"
        ? formatValue(value, props.format, undefined, props.currency)
        : stringify(value);
    const multi = model.series.length > 1;
    const seriesNames = model.series.map((s) => s.label ?? s.key);
    const color = { domain: seriesNames, range: palette };
    const seriesLegend: LegendItem[] = multi
      ? seriesNames.map((label, index) => ({ label, color: palette[index % palette.length] }))
      : [];
    const options = {
      keyboard: true,
      svgAnimation: { duration: 300, respectReducedMotion: true },
      tooltip: {
        use: tooltip,
        format: (point: { datum: Point }) =>
          multi
            ? `${point.datum.series}: ${fmt(point.datum.value)}`
            : `${stringify(point.datum.x)}: ${fmt(point.datum.value)}`,
      },
    };

    if (props.kind === "pie" || props.kind === "donut") {
      const slices = model.data.slice(0, MAX_SERIES).map((row) => ({
        name: stringify(row[model.xKey]),
        value: Math.max(0, numeric(row[model.series[0]?.key ?? ""]) ?? 0),
      }));
      const donut = props.kind === "donut";
      const total = slices.reduce((sum, slice) => sum + slice.value, 0);
      const legend = slices.map((slice, index) => ({
        label: slice.name,
        color: palette[index % palette.length],
        detail: total > 0 ? `${Math.round((slice.value / total) * 100)}%` : undefined,
      }));
      const definition = define(
        defineChart(
          {
            marks: [
              polar({
                marks: [
                  radialArc(pie(slices, { value: "value", gapAngle: 0.02 }), {
                    key: "name",
                    color: "name",
                    innerRadius: donut ? (context) => context.radius * 0.55 : 0,
                    cornerRadius: 2,
                  }),
                ],
                scales: { angle: null, radius: null },
                radiusRatio: 0.92,
              }),
            ],
            scales: { x: null, y: null },
            color: { domain: slices.map((slice) => slice.name), range: palette },
            theme,
            margin: 4,
          },
          {
            ...options,
            tooltip: {
              use: tooltip,
              format: (point: { datum: { name: string; value: number; fraction?: number } }) =>
                `${point.datum.name}: ${fmt(point.datum.value)}${
                  point.datum.fraction !== undefined ? ` (${Math.round(point.datum.fraction * 100)}%)` : ""
                }`,
            },
          },
        ),
      );
      return { definition, legend };
    }

    const valueAxis = {
      scale: scaleLinear,
      nice: true,
      grid: true,
      axis: { label: props.yLabel, ticks: { format: (value: number) => fmt(value) } },
    };
    const categoryAxis = {
      scale: props.kind === "bar" ? () => scaleBand().padding(multi && !props.stacked ? 0.25 : 0.3) : scalePoint,
      axis: { label: props.xLabel },
    };
    const numericX = { scale: scaleLinear, nice: true, grid: true, axis: { label: props.xLabel } };
    const series = multi ? ("series" as const) : undefined;

    if (props.kind === "scatter") {
      return {
        definition: define(
          defineChart(
            {
              marks: [dot(model.points, { x: "x", y: "value", color: series, r: 4.5, fillOpacity: 0.85 })],
              scales: { x: model.xNumeric ? numericX : categoryAxis, y: valueAxis },
              color,
              theme,
            },
            options,
          ),
        ),
        legend: seriesLegend,
      };
    }

    if (props.kind === "bar" && props.horizontal) {
      return {
        definition: define(
          defineChart(
            {
              marks: [
                barX(model.points, {
                  x: "value",
                  y: "x",
                  color: series,
                  layout: multi ? (props.stacked ? stack() : group()) : undefined,
                  inset: 1,
                  radius: { end: 3 },
                }),
              ],
              scales: { x: valueAxis, y: { ...categoryAxis, scale: () => scaleBand().padding(0.3) } },
              color,
              theme,
            },
            options,
          ),
        ),
        legend: seriesLegend,
      };
    }

    if (props.kind === "bar") {
      return {
        definition: define(
          defineChart(
            {
              marks: [
                barY(model.points, {
                  x: "x",
                  y: "value",
                  color: series,
                  layout: multi ? (props.stacked ? stack() : group()) : undefined,
                  inset: 1,
                  radius: { end: 3 },
                }),
                ruleY([0]),
              ],
              scales: { x: categoryAxis, y: valueAxis },
              color,
              theme,
            },
            options,
          ),
        ),
        legend: seriesLegend,
      };
    }

    const marks =
      props.kind === "area"
        ? [
            areaY(model.points, {
              x: "x",
              y: "value",
              color: series,
              fillOpacity: props.stacked ? 0.8 : 0.22,
              layout: props.stacked && multi ? stack() : undefined,
            }),
            lineY(model.points, { x: "x", y: "value", color: series, strokeWidth: 2 }),
          ]
        : [lineY(model.points, { x: "x", y: "value", color: series, strokeWidth: 2, points: model.data.length <= 40 })];
    return {
      definition: define(defineChart({ marks, scales: { x: categoryAxis, y: valueAxis }, color, theme }, options)),
      legend: seriesLegend,
    };
  }, [empty, isDark, model, props]);

  if (empty || !chart) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-neutral-300 py-6 text-xs text-neutral-500 dark:border-neutral-700"
        style={{ height }}
      >
        No data to chart
      </div>
    );
  }

  return (
    <figure className="w-full min-w-0 text-neutral-700 dark:text-neutral-300">
      {props.title && (
        <figcaption className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {props.title}
        </figcaption>
      )}
      <Chart ariaLabel={props.title ?? `${props.kind} chart`} definition={chart.definition} height={height} />
      <Legend items={chart.legend} />
    </figure>
  );
}
