import { Description, Field as HeadlessField, Label, Switch } from "@headlessui/react";
import { CheckCircle2, Info, XCircle, AlertTriangle } from "lucide-react";
import { lazy, Suspense, useId, useState, type ReactNode, type CSSProperties } from "react";
import { cn } from "@/shared/lib/cn";
import { formatValue, stringify, truthy } from "@/shared/lib/inlineUi/expression";
import { CodeRenderer } from "@/shared/ui/CodeRenderer";
import { SelectMenu } from "@/shared/ui/SelectMenu";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { HtmlPreview } from "@/shared/ui/HtmlPreview";
import { UiIcon } from "./UiIcon";
import { UiSvg } from "./UiSvg";
import { UiTable } from "./UiTable";
import type { WingmanProps } from "@/shared/lib/inlineUi/rendererTypes";
import type { WingmanRenderers } from "./rendererRegistry";
import { ChoiceControl } from "@/shared/ui/forms/ChoiceControl";
import { buttonClass, fieldLabelClass, inputClass } from "@/shared/ui/forms/controlStyles";

const UiChart = lazy(() => import("./UiChart").then((module) => ({ default: module.UiChart })));
const BADGE_TONES = new Set(["neutral", "info", "success", "warning", "error"]);
function num(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown): boolean {
  if (typeof value === "string") return value !== "" && value !== "false" && value !== "0";
  return truthy(value);
}

const GAP: Record<string, string> = { none: "gap-0", sm: "gap-2", md: "gap-3", lg: "gap-5" };

/** A source or "illustrative values" note under a chart or table. */
function Captioned({ caption, children }: { caption: unknown; children: React.ReactNode }) {
  const text = stringify(caption);
  if (!text) return <>{children}</>;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {children}
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{text}</p>
    </div>
  );
}

type Option = { value: string; label: string };

function toOptions(raw: unknown): Option[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 500).map((item) => {
    if (item && typeof item === "object" && "value" in item) {
      const value = stringify((item as { value: unknown }).value);
      const label = (item as { label?: unknown }).label;
      return { value, label: typeof label === "string" && label ? label : value };
    }
    const value = stringify(item);
    return { value, label: value };
  });
}

function Metric(props: WingmanProps["Metric"]) {
  const value = props.value;
  const format = typeof props.format === "string" ? props.format : undefined;
  const digits = props.digits === undefined ? undefined : num(props.digits, 0);
  const text =
    format && format !== "text"
      ? formatValue(value, format, digits, props.currency)
      : typeof value === "number"
        ? formatValue(value, "number", digits)
        : stringify(value);
  const deltaRaw = props.delta;
  const delta =
    typeof deltaRaw === "number" ? deltaRaw : deltaRaw === undefined || deltaRaw === "" ? undefined : Number(deltaRaw);
  const deltaText =
    delta !== undefined && Number.isFinite(delta)
      ? `${delta > 0 ? "+" : ""}${format && format !== "text" ? formatValue(delta, format, digits, props.currency) : formatValue(delta, "number", digits)}`
      : typeof deltaRaw === "string"
        ? deltaRaw
        : undefined;
  const tone =
    delta !== undefined && Number.isFinite(delta) ? (delta > 0 ? "up" : delta < 0 ? "down" : "flat") : "flat";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{stringify(props.label)}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
          {text || "—"}
        </span>
        {props.unit ? <span className="text-sm text-neutral-500">{stringify(props.unit)}</span> : null}
      </span>
      {!!(deltaText || props.description) && (
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          {deltaText && (
            <span
              className={cn(
                "font-medium tabular-nums",
                tone === "up" && "text-emerald-700 dark:text-emerald-400",
                tone === "down" && "text-red-700 dark:text-red-400",
                tone === "flat" && "text-neutral-500",
              )}
            >
              {deltaText}
              {props.deltaLabel ? ` ${stringify(props.deltaLabel)}` : ""}
            </span>
          )}
          {props.description ? (
            <span className="text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</span>
          ) : null}
        </span>
      )}
    </div>
  );
}

const CALLOUT: Record<string, { icon: typeof Info; className: string }> = {
  info: {
    icon: Info,
    className: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100",
  },
  success: {
    icon: CheckCircle2,
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100",
  },
  warning: {
    icon: AlertTriangle,
    className:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100",
  },
  error: {
    icon: XCircle,
    className: "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100",
  },
};

function Collapsible({ props, children }: { props: WingmanProps["Collapsible"]; children?: ReactNode }) {
  const [open, setOpen] = useState(() => bool(props.defaultOpen));
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="min-w-0 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/40"
    >
      <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-medium text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-neutral-100">
        {stringify(props.title)}
      </summary>
      <div className="flex min-w-0 flex-col gap-3 px-4 pb-4">
        {props.description ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</p>
        ) : null}
        {children}
      </div>
    </details>
  );
}

/** Each renderer is checked against its catalog schema, including nested resolved props. */
export const wingmanRenderers = {
  Grid: function GridView({ props, children }) {
    const columns = props.columns === undefined ? 0 : Math.max(1, Math.min(6, Math.round(num(props.columns, 2))));
    const style: CSSProperties = {
      gridTemplateColumns: columns ? `repeat(${columns}, minmax(0, 1fr))` : "repeat(auto-fit, minmax(160px, 1fr))",
    };
    return (
      <div className={cn("grid min-w-0 max-sm:grid-cols-1!", GAP[str(props.gap, "md")] ?? GAP.md)} style={style}>
        {children}
      </div>
    );
  },
  Collapsible: function CollapsibleView({ props, children }) {
    return <Collapsible props={props}>{children}</Collapsible>;
  },
  Badge: function BadgeView({ props }) {
    const tone = BADGE_TONES.has(str(props.tone, "")) ? str(props.tone, "") : "neutral";
    return (
      <span
        className={cn(
          "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium",
          tone === "neutral" &&
            "border-neutral-300 bg-neutral-100 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
          tone === "info" &&
            "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200",
          tone === "success" &&
            "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200",
          tone === "warning" &&
            "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
          tone === "error" &&
            "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200",
        )}
      >
        {stringify(props.text)}
      </span>
    );
  },
  Code: function CodeView({ props }) {
    return <CodeRenderer code={stringify(props.text)} language={str(props.language, "text")} subtle />;
  },
  Heading: function HeadingView({ props }) {
    const level = Math.max(1, Math.min(4, Math.round(num(props.level, 2))));
    const className = cn(
      "font-semibold text-neutral-900 dark:text-neutral-100",
      level === 1 && "text-xl",
      level === 2 && "text-lg",
      level === 3 && "text-base",
      level === 4 && "text-sm",
    );
    const text = stringify(props.text);
    if (level === 1) return <h2 className={className}>{text}</h2>;
    if (level === 2) return <h3 className={className}>{text}</h3>;
    if (level === 3) return <h4 className={className}>{text}</h4>;
    return <h5 className={className}>{text}</h5>;
  },
  Metric: function MetricView({ props }) {
    return <Metric {...props} />;
  },
  Callout: function CalloutView({ props, renderText }) {
    const tone = CALLOUT[str(props.tone, "info")] ?? CALLOUT.info;
    const Icon = tone.icon;
    return (
      <div className={cn("flex gap-2.5 rounded-md border px-3 py-2.5 text-sm", tone.className)}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          {props.title ? <p className="font-medium">{stringify(props.title)}</p> : null}
          <div className={cn(!!props.title && "mt-0.5", "opacity-90")}>
            {renderText ? renderText(stringify(props.text)) : stringify(props.text)}
          </div>
        </div>
      </div>
    );
  },
  Progress: function ProgressView({ props }) {
    const max = Math.max(1e-9, num(props.max, 100));
    const current = Math.max(0, Math.min(max, num(props.value, 0)));
    const format = typeof props.format === "string" && props.format !== "text" ? props.format : null;
    const label = format ? formatValue(current, format) : `${Math.round((current / max) * 100)}%`;
    return (
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          {props.label ? <span className={fieldLabelClass}>{stringify(props.label)}</span> : <span />}
          <span className="tabular-nums text-neutral-600 dark:text-neutral-400">{label}</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={max}
        >
          <div
            className="h-full rounded-full bg-neutral-800 transition-[width] dark:bg-neutral-200"
            style={{ width: `${(current / max) * 100}%` }}
          />
        </div>
      </div>
    );
  },
  Svg: function SvgView({ props }) {
    return (
      <UiSvg
        markup={stringify(props.markup)}
        height={props.height === undefined ? undefined : num(props.height, 0)}
        label={typeof props.label === "string" ? props.label : undefined}
      />
    );
  },
  Segmented: function SegmentedView({ props, change: set, validation }) {
    const value = props.value;
    return (
      <SegmentedControl
        invalid={validation["aria-invalid"]}
        errorId={validation["aria-errormessage"]}
        label={typeof props.label === "string" ? props.label : undefined}
        description={typeof props.description === "string" ? props.description : undefined}
        value={stringify(value)}
        options={toOptions(props.options)}
        disabled={bool(props.disabled)}
        onChange={(next) => set(next)}
      />
    );
  },
  Timeline: function TimelineView({ props }) {
    const items = (Array.isArray(props.items) ? props.items.slice(0, 200) : []).map((item) =>
      item && typeof item === "object"
        ? {
            label: stringify((item as { label?: unknown }).label),
            time: stringify((item as { time?: unknown }).time),
            description: stringify((item as { description?: unknown }).description),
          }
        : { label: stringify(item), time: "", description: "" },
    );
    const activeRaw = props.active;
    const active =
      activeRaw === undefined || activeRaw === null || activeRaw === ""
        ? -1
        : typeof activeRaw === "number"
          ? Math.round(activeRaw)
          : items.findIndex((item) => item.label === stringify(activeRaw)) >= 0
            ? items.findIndex((item) => item.label === stringify(activeRaw))
            : Number.isFinite(Number(activeRaw))
              ? Math.round(Number(activeRaw))
              : -1;
    return (
      <ol className="flex min-w-0 flex-col text-sm">
        {items.map((item, index) => {
          const state = active < 0 ? "none" : index < active ? "done" : index === active ? "current" : "todo";
          return (
            <li key={index} className="relative flex gap-3 pb-3 last:pb-0">
              <span className="flex w-3 shrink-0 flex-col items-center">
                <span
                  className={cn(
                    "mt-1.5 h-3 w-3 rounded-full border-2",
                    state === "current" &&
                      "border-neutral-900 bg-neutral-900 dark:border-neutral-100 dark:bg-neutral-100",
                    state === "done" && "border-neutral-500 bg-neutral-500 dark:border-neutral-400 dark:bg-neutral-400",
                    (state === "todo" || state === "none") &&
                      "border-neutral-400 bg-transparent dark:border-neutral-600",
                  )}
                />
                {index < items.length - 1 && (
                  <span className="mt-1 w-px flex-1 bg-neutral-300 dark:bg-neutral-700" aria-hidden />
                )}
              </span>
              <span className={cn("min-w-0 flex-1", state === "done" && "text-neutral-500 dark:text-neutral-400")}>
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className={cn(state === "current" ? "font-semibold" : "font-medium")}>{item.label}</span>
                  {item.time && (
                    <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{item.time}</span>
                  )}
                </span>
                {item.description && (
                  <span className="block text-xs text-neutral-600 dark:text-neutral-400">{item.description}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    );
  },
  KeyValue: function KeyValueView({ props }) {
    const items = (Array.isArray(props.items) ? props.items.slice(0, 100) : []) as {
      label: unknown;
      value: unknown;
    }[];
    const columns = Math.max(1, Math.min(3, Math.round(num(props.columns, 1))));
    return (
      <dl
        className={cn("grid min-w-0 gap-x-6 gap-y-1.5 text-sm", columns > 1 && "max-sm:grid-cols-1!")}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {items.map((item, index) => (
          <div key={index} className="flex min-w-0 gap-2">
            <dt className="shrink-0 font-medium text-neutral-500 dark:text-neutral-400">{stringify(item.label)}</dt>
            <dd className="min-w-0 text-neutral-900 dark:text-neutral-100">
              {typeof item.value === "boolean" ? (item.value ? "Yes" : "No") : stringify(item.value)}
            </dd>
          </div>
        ))}
      </dl>
    );
  },
  Stepper: function StepperView({ props, change: set, validation }) {
    const value = props.value;
    const min = props.min === undefined ? -Infinity : num(props.min, 0);
    const max = props.max === undefined ? Infinity : num(props.max, 0);
    const step = num(props.step, 1) || 1;
    const current = num(value, Number.isFinite(min) ? Math.max(0, min) : 0);
    const disabled = bool(props.disabled);
    const apply = (next: number) => set(Math.min(max, Math.max(min, Number(next.toFixed(6)))));
    const stepButton = cn(buttonClass, "flex size-10 shrink-0 items-center justify-center p-0 text-lg leading-none");
    return (
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        {props.label ? <span className={fieldLabelClass}>{stringify(props.label)}</span> : null}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={stepButton}
            disabled={disabled || current <= min}
            onClick={() => apply(current - step)}
            aria-label="Decrease"
          >
            −
          </button>
          <input
            {...validation}
            type="number"
            className={cn(inputClass, "w-20 text-center tabular-nums")}
            value={current}
            min={Number.isFinite(min) ? min : undefined}
            max={Number.isFinite(max) ? max : undefined}
            step={step}
            disabled={disabled}
            onChange={(event) => {
              if (event.target.value !== "") apply(Number(event.target.value));
            }}
            aria-label={stringify(props.label) || undefined}
          />
          <button
            type="button"
            className={stepButton}
            disabled={disabled || current >= max}
            onClick={() => apply(current + step)}
            aria-label="Increase"
          >
            +
          </button>
          {props.unit ? <span className="text-neutral-500 dark:text-neutral-400">{stringify(props.unit)}</span> : null}
        </div>
        {props.description ? (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</span>
        ) : null}
      </div>
    );
  },
  Checklist: function ChecklistView({ props, change: set, validation }) {
    const value = props.value;
    const items = (Array.isArray(props.items) ? props.items.slice(0, 200) : []).map((item) =>
      item && typeof item === "object"
        ? {
            label: stringify((item as { label?: unknown }).label),
            time: stringify((item as { time?: unknown }).time),
            description: stringify((item as { description?: unknown }).description),
          }
        : { label: stringify(item), time: "", description: "" },
    );
    const checked = new Set(Array.isArray(value) ? value.map(stringify) : []);
    const done = items.filter((item) => checked.has(item.label)).length;
    const toggleItem = (label: string, on: boolean) => {
      const current = Array.isArray(value) ? value.map(stringify) : [];
      set(on ? [...current.filter((item) => item !== label), label] : current.filter((item) => item !== label));
    };
    return (
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          {props.label ? <span className={fieldLabelClass}>{stringify(props.label)}</span> : <span />}
          <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
            {done} of {items.length}
          </span>
        </div>
        <ol className="flex flex-col">
          {items.map((item, index) => {
            const on = checked.has(item.label);
            return (
              <li
                key={index}
                className="flex gap-3 border-t border-neutral-200 py-2 first:border-t-0 dark:border-neutral-800"
              >
                <ChoiceControl
                  {...validation}
                  type="checkbox"
                  checked={on}
                  disabled={bool(props.disabled)}
                  onChange={(event) => toggleItem(item.label, event.target.checked)}
                  aria-label={item.label}
                  className="w-full items-start py-0 [&>input]:mt-0.5"
                >
                  <span className={cn("block min-w-0", on && "text-neutral-500 dark:text-neutral-500")}>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className={cn("font-medium", on && "line-through")}>{item.label}</span>
                      {item.time && (
                        <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{item.time}</span>
                      )}
                    </span>
                    {item.description && (
                      <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                        {item.description}
                      </span>
                    )}
                  </span>
                </ChoiceControl>
              </li>
            );
          })}
        </ol>
        {props.description ? (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</span>
        ) : null}
      </div>
    );
  },
  Link: function LinkView({ props }) {
    const href = stringify(props.href).trim();
    if (!/^(https?:\/\/|mailto:)/i.test(href)) {
      return <span className="text-sm text-neutral-500">{stringify(props.text) || href}</span>;
    }
    const chip = props.kind === "chip";
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        title={typeof props.description === "string" ? props.description : undefined}
        className={cn(
          chip
            ? "inline-flex max-w-full items-center gap-1 rounded-full border border-neutral-300 px-2.5 py-0.5 text-xs text-neutral-700 hover:bg-neutral-200 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            : "text-sm text-neutral-900 underline decoration-neutral-400 underline-offset-2 hover:decoration-neutral-900 dark:text-neutral-100 dark:decoration-neutral-600 dark:hover:decoration-neutral-100",
        )}
      >
        <span className="truncate">{stringify(props.text) || href}</span>
        {chip && <UiIcon name="external-link" size={11} />}
      </a>
    );
  },
  Html: function HtmlView({ props }) {
    // The page is self-contained: it is not template-resolved, so scripts may use `{{` freely.
    const markup = stringify(props.markup);
    const height = Math.max(120, Math.min(800, num(props.height, 320)));
    return (
      <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
        <HtmlPreview
          content={markup}
          title={typeof props.title === "string" ? props.title : "Embedded page"}
          className="w-full"
          style={{ height }}
          reloadDebounceMs={250}
        />
      </div>
    );
  },
  TextList: function TextListView({ props }) {
    const items = Array.isArray(props.items) ? props.items.slice(0, 500) : [];
    const Tag = bool(props.ordered) ? "ol" : "ul";
    return (
      <Tag
        className={cn(
          "min-w-0 pl-5 text-sm text-neutral-800 dark:text-neutral-200",
          Tag === "ol" ? "list-decimal" : "list-disc",
        )}
      >
        {items.map((item, index) => {
          const label =
            item && typeof item === "object" && "label" in item
              ? stringify((item as { label: unknown }).label)
              : stringify(item);
          const detail =
            item && typeof item === "object" && "value" in item ? stringify((item as { value: unknown }).value) : "";
          return (
            <li key={index} className="py-0.5">
              {label}
              {detail ? <span className="ml-2 text-neutral-500 dark:text-neutral-400">{detail}</span> : null}
            </li>
          );
        })}
      </Tag>
    );
  },
  Table: function TableView({ props }) {
    return (
      <Captioned caption={props.caption}>
        <UiTable
          {...props}
          sortable={props.sortable === undefined ? true : bool(props.sortable)}
          pageSize={props.pageSize === undefined ? undefined : num(props.pageSize, 15)}
        />
      </Captioned>
    );
  },
  Chart: function ChartView({ props }) {
    return (
      <Suspense
        fallback={
          <div
            className="flex items-center justify-center text-xs text-neutral-500"
            style={{ height: props.height === undefined ? 260 : num(props.height, 260) }}
          >
            Loading chart…
          </div>
        }
      >
        <Captioned caption={props.caption}>
          <UiChart
            {...props}
            stacked={bool(props.stacked)}
            horizontal={bool(props.horizontal)}
            height={props.height === undefined ? undefined : num(props.height, 260)}
          />
        </Captioned>
      </Suspense>
    );
  },
  Select: function SelectView({ props, change: set, validation }) {
    const value = props.value;
    const options = toOptions(props.options);
    const current = stringify(value);
    return (
      <SelectMenu
        invalid={validation["aria-invalid"]}
        errorId={validation["aria-errormessage"]}
        label={typeof props.label === "string" ? props.label : undefined}
        hint={typeof props.description === "string" ? props.description : undefined}
        value={options.some((option) => option.value === current) ? current : null}
        options={options}
        disabled={bool(props.disabled) || options.length === 0}
        onChange={(next) => {
          if (next !== null) set(next);
        }}
      />
    );
  },
  MultiSelect: function MultiSelectView({ props, change: set, validation }) {
    const value = props.value;
    const options = toOptions(props.options);
    const selected = Array.isArray(value) ? value.map(stringify) : [];
    const toggleOption = (option: Option, checked: boolean) => {
      const current = Array.isArray(value) ? value : [];
      const without = current.filter((item) => stringify(item) !== option.value);
      set(checked ? [...without, option.value] : without);
    };
    return (
      <fieldset {...validation} className="flex min-w-0 flex-col gap-1 text-sm" disabled={bool(props.disabled)}>
        {props.label ? <legend className={cn(fieldLabelClass, "mb-1.5")}>{stringify(props.label)}</legend> : null}
        <div className="grid grid-cols-1 gap-x-4 gap-y-1">
          {options.map((option) => (
            <ChoiceControl
              key={option.value}
              type="checkbox"
              value={option.value}
              checked={selected.includes(option.value)}
              disabled={bool(props.disabled)}
              {...validation}
              onChange={(event) => toggleOption(option, event.target.checked)}
            >
              {option.label}
            </ChoiceControl>
          ))}
        </div>
        {props.description ? (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</span>
        ) : null}
      </fieldset>
    );
  },
  Radio: function RadioView({ props, change: set, validation }) {
    const value = props.value;
    const controlId = useId();
    const options = toOptions(props.options);
    const current = stringify(value);
    return (
      <fieldset {...validation} className="flex min-w-0 flex-col gap-1 text-sm" disabled={bool(props.disabled)}>
        {props.label ? <legend className={cn(fieldLabelClass, "mb-1.5")}>{stringify(props.label)}</legend> : null}
        {options.map((option) => (
          <ChoiceControl
            key={option.value}
            type="radio"
            name={controlId}
            value={option.value}
            checked={current === option.value}
            disabled={bool(props.disabled)}
            {...validation}
            onChange={() => set(option.value)}
          >
            {option.label}
          </ChoiceControl>
        ))}
        {props.description ? (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</span>
        ) : null}
      </fieldset>
    );
  },
  Toggle: function ToggleView({ props, change: set, validation }) {
    const value = props.value;
    return (
      <HeadlessField disabled={bool(props.disabled)} className="flex min-w-0 flex-col gap-1.5 text-sm">
        <div className="flex min-h-9 items-center gap-3">
          <Switch
            {...validation}
            checked={bool(value)}
            onChange={set}
            className="group inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-neutral-300 p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60 focus-visible:ring-offset-2 data-checked:bg-neutral-900 data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:bg-neutral-700 dark:focus-visible:ring-neutral-500/60 dark:focus-visible:ring-offset-neutral-900 dark:data-checked:bg-neutral-200"
          >
            <span
              aria-hidden="true"
              className="size-5 rounded-full bg-white shadow-sm transition-transform group-data-checked:translate-x-5 motion-reduce:transition-none dark:bg-neutral-300 dark:group-data-checked:bg-neutral-900"
            />
          </Switch>
          {props.label ? (
            <Label className="text-neutral-800 dark:text-neutral-200">{stringify(props.label)}</Label>
          ) : null}
        </div>
        {props.description ? (
          <Description className="text-xs text-neutral-500 dark:text-neutral-400">
            {stringify(props.description)}
          </Description>
        ) : null}
      </HeadlessField>
    );
  },
} satisfies Omit<WingmanRenderers, "Form">;
