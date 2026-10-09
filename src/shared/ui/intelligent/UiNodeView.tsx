import { Description, Field as HeadlessField, Label, Switch } from "@headlessui/react";
import { useSelector } from "@tanstack/react-store";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { createContext, type CSSProperties, lazy, memo, Suspense, useContext, useId, useState } from "react";
import { cn } from "@/shared/lib/cn";
import {
  extendScope,
  formatValue,
  isTemplate,
  type Scope,
  stringify,
  truthy,
} from "@/shared/lib/intelligentUi/expression";
import type { UiAction, UiNode, UiProps } from "@/shared/lib/intelligentUi/schema";
import { CodeRenderer } from "@/shared/ui/CodeRenderer";
import { SelectMenu } from "@/shared/ui/SelectMenu";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { UiContext, type UiHostContext } from "./UiContext";
import type { UiChartProps } from "./UiChart";
import { HtmlPreview } from "@/shared/ui/HtmlPreview";
import { UiIcon } from "./UiIcon";
import { UiSvg } from "./UiSvg";
import { UiTable, type UiTableProps } from "./UiTable";

// Charts pull in the chart grammar and its D3 modules; load them with the first chart.
const UiChart = lazy(() => import("./UiChart").then((module) => ({ default: module.UiChart })));

// ── Prop resolution ────────────────────────────────────────────────────────

/** Resolve templates anywhere inside a prop value; `action` stays raw until it runs. */
function resolveDeep(value: unknown, resolve: (value: unknown) => unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (isTemplate(value)) return resolve(value);
  if (Array.isArray(value)) return value.map((item) => resolveDeep(item, resolve, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = resolveDeep(item, resolve, depth + 1);
    return out;
  }
  return value;
}

/** Props that hold child components or deferred actions rather than values, so templates inside them stay raw. */
const RAW_PROPS: Partial<Record<UiNode["type"], Set<string>>> = {
  tabs: new Set(["items"]),
  button: new Set(["action"]),
  form: new Set(["action"]),
  html: new Set(["markup"]),
};

function resolveProps(
  type: UiNode["type"],
  props: UiProps,
  resolve: (value: unknown) => unknown,
  condition: (value: unknown) => boolean,
): UiProps {
  const raw = RAW_PROPS[type];
  const out: UiProps = {};
  for (const [key, value] of Object.entries(props)) {
    out[key] = raw?.has(key) ? value : key === "disabled" ? condition(value) : resolveDeep(value, resolve);
  }
  return out;
}

/**
 * Values an `each` component adds for its children (`item`, `index` and the
 * `as` name). Nested iterations merge with the enclosing one.
 */
const IterationContext = createContext<Scope | null>(null);
const BADGE_TONES = new Set(["neutral", "info", "success", "warning", "error"]);
const MAX_ITERATIONS = 200;

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
const ALIGN: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};
const JUSTIFY: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
};

const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none focus:border-neutral-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-400";

function Field({
  label,
  description,
  children,
  inline,
}: {
  label?: string;
  description?: string;
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <label className={cn("flex min-w-0 text-sm", inline ? "flex-row items-center gap-2" : "flex-col gap-1")}>
      {label && !inline && <span className="font-medium text-neutral-700 dark:text-neutral-300">{label}</span>}
      {children}
      {label && inline && <span className="text-neutral-800 dark:text-neutral-200">{label}</span>}
      {description && <span className="text-xs text-neutral-500 dark:text-neutral-400">{description}</span>}
    </label>
  );
}

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

// ── Components ─────────────────────────────────────────────────────────────

function Children({ nodes }: { nodes: UiNode[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <UiNodeView key={`${node.type}-${index}`} node={node} />
      ))}
    </>
  );
}

function Tabs({ items }: { items: { label: string; children: UiNode[] }[] }) {
  const [active, setActive] = useState(0);
  const current = items[Math.min(active, items.length - 1)];
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {items.map((item, index) => (
          <button
            key={`${item.label}-${index}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            onClick={() => setActive(index)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors",
              index === active
                ? "border-neutral-800 font-medium text-neutral-900 dark:border-neutral-200 dark:text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-3">{current && <Children nodes={current.children} />}</div>
    </div>
  );
}

function Metric(props: UiProps) {
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

function Button({
  props,
  context,
  extra,
  formContent,
}: {
  props: UiProps;
  context: UiHostContext;
  extra: Scope | null;
  /** A form and its submit button share the same action and pending state. */
  formContent?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const disabled = !!context.streaming || bool(props.disabled) || busy;
  const variant = typeof props.variant === "string" ? props.variant : "secondary";
  const actions = (Array.isArray(props.action) ? props.action : []) as UiAction[];
  const onClick = async () => {
    if (disabled) return;
    if (typeof props.confirm === "string" && props.confirm.trim()) {
      const ok = await (context.host.confirm?.(stringify(props.confirm)) ?? true);
      if (!ok) return;
    }
    setBusy(true);
    const failure = await context.runtime.run(actions, context.host, extra ?? undefined).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : "The action failed"),
    );
    setBusy(false);
    if (failure) context.host.notify?.(failure, "error");
  };
  const button = (
    <button
      type={formContent === undefined ? "button" : "submit"}
      onClick={formContent === undefined ? () => void onClick() : undefined}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300",
        variant === "secondary" &&
          "bg-neutral-200 text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700",
        variant === "ghost" && "text-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600",
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : typeof props.icon === "string" && props.icon ? (
        <UiIcon name={props.icon} size={14} />
      ) : null}
      {stringify(props.label)}
    </button>
  );
  if (formContent === undefined) return button;
  return (
    <form
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void onClick();
      }}
    >
      {formContent}
      <div className="flex justify-end">{button}</div>
    </form>
  );
}

function Slider({ props, value, onChange }: { props: UiProps; value: unknown; onChange: (value: number) => void }) {
  const min = num(props.min, 0);
  const max = num(props.max, 100);
  const step = num(props.step, 1);
  const current = num(value, min);
  const format = typeof props.format === "string" && props.format !== "text" ? props.format : "number";
  const digits = props.digits === undefined ? undefined : num(props.digits, 0);
  const display = `${formatValue(current, format, digits, props.currency)}${props.unit ? ` ${stringify(props.unit)}` : ""}`;
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">{stringify(props.label)}</span>
        <span className="tabular-nums text-neutral-900 dark:text-neutral-100">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        disabled={bool(props.disabled)}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={stringify(props.label) || undefined}
        className="w-full accent-neutral-800 disabled:opacity-50 dark:accent-neutral-200"
      />
      {props.description ? (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</span>
      ) : null}
    </div>
  );
}

function Input({ props, value, onChange }: { props: UiProps; value: unknown; onChange: (value: unknown) => void }) {
  const kind = typeof props.kind === "string" ? props.kind : "text";
  const common = {
    placeholder: typeof props.placeholder === "string" ? props.placeholder : undefined,
    disabled: bool(props.disabled),
    className: inputClass,
  };
  return (
    <Field
      label={typeof props.label === "string" ? props.label : undefined}
      description={typeof props.description === "string" ? props.description : undefined}
    >
      {kind === "multiline" ? (
        <textarea {...common} rows={3} value={stringify(value)} onChange={(event) => onChange(event.target.value)} />
      ) : kind === "date" ? (
        <input
          {...common}
          type="date"
          value={/^\d{4}-\d{2}-\d{2}/.test(stringify(value)) ? stringify(value).slice(0, 10) : ""}
          min={typeof props.min === "string" ? props.min : undefined}
          max={typeof props.max === "string" ? props.max : undefined}
          onChange={(event) => onChange(event.target.value || null)}
        />
      ) : kind === "number" ? (
        <input
          {...common}
          type="number"
          value={value === null || value === undefined ? "" : stringify(value)}
          min={props.min === undefined ? undefined : num(props.min, 0)}
          max={props.max === undefined ? undefined : num(props.max, 0)}
          step={props.step === undefined ? undefined : num(props.step, 1)}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        />
      ) : (
        <input {...common} type="text" value={stringify(value)} onChange={(event) => onChange(event.target.value)} />
      )}
    </Field>
  );
}

function coerceOption(value: string, options: unknown): unknown {
  // Give back the option's original type (numbers stay numbers).
  if (Array.isArray(options)) {
    for (const option of options) {
      const raw =
        option && typeof option === "object" && "value" in option ? (option as { value: unknown }).value : option;
      if (stringify(raw) === value) return raw;
    }
  }
  return value;
}

// ── Node ───────────────────────────────────────────────────────────────────

function NodeContent({
  node,
  props,
  values,
  context,
  extra,
}: {
  node: Exclude<UiNode, { type: "error" }>;
  props: UiProps;
  values: Scope;
  context: UiHostContext;
  extra: Scope | null;
}) {
  const { runtime, renderText } = context;
  const controlId = useId();
  const bind = node.bind ?? "";
  const value = bind ? values[bind] : undefined;
  const set = (next: unknown) => runtime.setValue(bind, next);

  switch (node.type) {
    case "column":
      return (
        <div
          className={cn(
            "flex min-w-0 flex-col",
            GAP[str(props.gap, "md")] ?? GAP.md,
            ALIGN[str(props.align, "stretch")],
          )}
        >
          <Children nodes={node.children} />
        </div>
      );
    case "row":
      return (
        <div
          className={cn(
            "flex min-w-0 [&>*]:min-w-0 [&>*]:flex-1",
            bool(props.wrap ?? true) && "flex-wrap",
            GAP[str(props.gap, "md")] ?? GAP.md,
            ALIGN[str(props.align, "stretch")],
            JUSTIFY[str(props.justify, "start")],
          )}
        >
          <Children nodes={node.children} />
        </div>
      );
    case "grid": {
      const columns =
        props.columns === "auto" || props.columns === undefined
          ? 0
          : Math.max(1, Math.min(6, Math.round(num(props.columns, 2))));
      const style: CSSProperties = {
        gridTemplateColumns: columns ? `repeat(${columns}, minmax(0, 1fr))` : "repeat(auto-fit, minmax(160px, 1fr))",
      };
      return (
        <div className={cn("grid min-w-0 max-sm:grid-cols-1!", GAP[str(props.gap, "md")] ?? GAP.md)} style={style}>
          <Children nodes={node.children} />
        </div>
      );
    }
    case "card":
      return (
        <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
          {!!(props.title || props.description) && (
            <header className="flex flex-col gap-0.5">
              {props.title ? (
                <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {stringify(props.title)}
                </h4>
              ) : null}
              {props.description ? (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</p>
              ) : null}
            </header>
          )}
          <Children nodes={node.children} />
        </section>
      );
    case "tabs":
      return <Tabs items={node.tabs ?? []} />;
    case "each": {
      const items = Array.isArray(props.items) ? props.items.slice(0, MAX_ITERATIONS) : [];
      const name = typeof props.as === "string" && props.as.trim() ? props.as.trim() : "item";
      return (
        <>
          {items.map((item, index) => (
            <IterationContext key={index} value={{ ...extra, item, index, [name]: item }}>
              <Children nodes={node.children} />
            </IterationContext>
          ))}
        </>
      );
    }
    case "badge": {
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
    }
    case "code":
      return <CodeRenderer code={stringify(props.text)} language={str(props.language, "text")} subtle />;
    case "divider":
      return <hr className="border-neutral-200 dark:border-neutral-800" />;
    case "heading": {
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
    }
    case "text": {
      const text = stringify(props.text);
      const className = cn(
        "min-w-0",
        props.size === "sm" && "text-xs",
        props.size === "lg" && "text-base",
        (props.size === undefined || props.size === "md") && "text-sm",
        props.tone === "muted" && "text-neutral-500 dark:text-neutral-400",
        props.tone === "accent" && "font-medium text-neutral-900 dark:text-neutral-100",
        props.align === "center" && "text-center",
        props.align === "end" && "text-right",
      );
      return <div className={className}>{renderText && /[*_`[\n#>-]/.test(text) ? renderText(text) : text}</div>;
    }
    case "metric":
      return <Metric {...props} />;
    case "callout": {
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
    }
    case "progress": {
      const max = Math.max(1e-9, num(props.max, 100));
      const current = Math.max(0, Math.min(max, num(props.value, 0)));
      const format = typeof props.format === "string" && props.format !== "text" ? props.format : null;
      const label = format ? formatValue(current, format) : `${Math.round((current / max) * 100)}%`;
      return (
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            {props.label ? (
              <span className="font-medium text-neutral-700 dark:text-neutral-300">{stringify(props.label)}</span>
            ) : (
              <span />
            )}
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
    }
    case "image": {
      const src = stringify(props.src);
      if (!/^(https?:|data:image\/)/i.test(src))
        return <p className="text-xs text-neutral-500">Image source must be an http(s) or data URL.</p>;
      return (
        <figure className="flex min-w-0 flex-col gap-1">
          <img
            src={src}
            alt={stringify(props.alt) || "Image"}
            loading="lazy"
            className="max-h-80 max-w-full rounded-md object-contain"
          />
          {props.caption ? (
            <figcaption className="text-xs text-neutral-500 dark:text-neutral-400">
              {stringify(props.caption)}
            </figcaption>
          ) : null}
        </figure>
      );
    }
    case "svg":
      return (
        <UiSvg
          markup={stringify(props.markup)}
          height={props.height === undefined ? undefined : num(props.height, 0)}
          label={typeof props.label === "string" ? props.label : undefined}
        />
      );
    case "segmented": {
      return (
        <SegmentedControl
          label={typeof props.label === "string" ? props.label : undefined}
          description={typeof props.description === "string" ? props.description : undefined}
          value={stringify(value)}
          options={toOptions(props.options)}
          disabled={bool(props.disabled)}
          onChange={(next) => set(coerceOption(next, props.options))}
        />
      );
    }
    case "timeline": {
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
                      state === "done" &&
                        "border-neutral-500 bg-neutral-500 dark:border-neutral-400 dark:bg-neutral-400",
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
    }
    case "keyvalue": {
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
    }
    case "stepper": {
      const min = props.min === undefined ? -Infinity : num(props.min, 0);
      const max = props.max === undefined ? Infinity : num(props.max, 0);
      const step = num(props.step, 1) || 1;
      const current = num(value, Number.isFinite(min) ? Math.max(0, min) : 0);
      const disabled = bool(props.disabled);
      const apply = (next: number) => set(Math.min(max, Math.max(min, Number(next.toFixed(6)))));
      const stepButton =
        "flex h-8 w-8 items-center justify-center rounded-md border border-neutral-300 text-lg leading-none text-neutral-700 hover:bg-neutral-200 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";
      return (
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          {props.label ? (
            <span className="font-medium text-neutral-700 dark:text-neutral-300">{stringify(props.label)}</span>
          ) : null}
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
            {props.unit ? (
              <span className="text-neutral-500 dark:text-neutral-400">{stringify(props.unit)}</span>
            ) : null}
          </div>
          {props.description ? (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</span>
          ) : null}
        </div>
      );
    }
    case "checklist": {
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
            {props.label ? (
              <span className="font-medium text-neutral-700 dark:text-neutral-300">{stringify(props.label)}</span>
            ) : (
              <span />
            )}
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
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={bool(props.disabled)}
                    onChange={(event) => toggleItem(item.label, event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded accent-neutral-800 dark:accent-neutral-200"
                    aria-label={item.label}
                  />
                  <span className={cn("min-w-0 flex-1", on && "text-neutral-500 line-through dark:text-neutral-500")}>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{item.label}</span>
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
          {props.description ? (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</span>
          ) : null}
        </div>
      );
    }
    case "icon": {
      const size = props.size === "sm" ? 14 : props.size === "lg" ? 28 : 20;
      const tone = str(props.tone, "default");
      return (
        <span
          role={props.label ? "img" : undefined}
          aria-label={typeof props.label === "string" ? props.label : undefined}
          aria-hidden={props.label ? undefined : true}
          className={cn(
            "inline-flex shrink-0 items-center",
            tone === "muted" && "text-neutral-500 dark:text-neutral-400",
            tone === "accent" && "text-neutral-900 dark:text-neutral-100",
            tone === "success" && "text-emerald-700 dark:text-emerald-400",
            tone === "warning" && "text-amber-700 dark:text-amber-400",
            tone === "error" && "text-red-700 dark:text-red-400",
          )}
        >
          <UiIcon name={props.name} size={size} />
        </span>
      );
    }
    case "link": {
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
    }
    case "html": {
      // The page is self-contained: it is not template-resolved, so scripts may use `{{` freely.
      const markup = stringify(node.props.markup);
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
    }
    case "form": {
      const required = Array.isArray(props.required) ? props.required.map(stringify) : [];
      const missing = required.some((key) => {
        const current = values[key];
        return (
          current === null ||
          current === undefined ||
          (typeof current === "string" && !current.trim()) ||
          (Array.isArray(current) && !current.length)
        );
      });
      const action = Array.isArray(node.props.action)
        ? (node.props.action as UiAction[])
        : [{ type: "send" as const, message: stringify(props.message ?? props.submit ?? "Submitted"), context: true }];
      return (
        <Button
          props={{ label: stringify(props.submit ?? "Submit"), action, variant: "primary", disabled: missing }}
          context={context}
          extra={extra}
          formContent={
            <>
              {props.title || props.description ? (
                <header className="flex flex-col gap-0.5">
                  {props.title ? (
                    <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {stringify(props.title)}
                    </h4>
                  ) : null}
                  {props.description ? (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</p>
                  ) : null}
                </header>
              ) : null}
              <Children nodes={node.children} />
            </>
          }
        />
      );
    }
    case "list": {
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
    }
    case "table":
      return (
        <Captioned caption={props.caption}>
          <UiTable
            {...(props as unknown as UiTableProps)}
            sortable={props.sortable === undefined ? true : bool(props.sortable)}
            pageSize={props.pageSize === undefined ? undefined : num(props.pageSize, 15)}
          />
        </Captioned>
      );
    case "chart":
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
              {...(props as unknown as UiChartProps)}
              stacked={bool(props.stacked)}
              horizontal={bool(props.horizontal)}
              height={props.height === undefined ? undefined : num(props.height, 260)}
            />
          </Captioned>
        </Suspense>
      );
    case "slider":
      return <Slider props={props} value={value} onChange={set} />;
    case "input":
      return <Input props={props} value={value} onChange={set} />;
    case "select": {
      const options = toOptions(props.options);
      const current = stringify(value);
      return (
        <SelectMenu
          label={typeof props.label === "string" ? props.label : undefined}
          hint={typeof props.description === "string" ? props.description : undefined}
          placeholder={typeof props.placeholder === "string" ? props.placeholder : undefined}
          value={options.some((option) => option.value === current) ? current : null}
          options={options}
          disabled={bool(props.disabled) || options.length === 0}
          onChange={(next) => {
            if (next !== null) set(coerceOption(next, props.options));
          }}
        />
      );
    }
    case "multiselect": {
      const options = toOptions(props.options);
      const selected = Array.isArray(value) ? value.map(stringify) : [];
      const columns = Math.max(1, Math.min(4, Math.round(num(props.columns, 1))));
      const toggleOption = (option: Option, checked: boolean) => {
        const current = Array.isArray(value) ? value : [];
        const without = current.filter((item) => stringify(item) !== option.value);
        set(checked ? [...without, coerceOption(option.value, props.options)] : without);
      };
      return (
        <fieldset className="flex min-w-0 flex-col gap-1 text-sm" disabled={bool(props.disabled)}>
          {props.label ? (
            <legend className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">
              {stringify(props.label)}
            </legend>
          ) : null}
          <div
            className={cn("grid gap-x-4 gap-y-1", columns > 1 && "max-sm:grid-cols-1!")}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {options.map((option) => (
              <label key={option.value} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  value={option.value}
                  checked={selected.includes(option.value)}
                  onChange={(event) => toggleOption(option, event.target.checked)}
                  className="h-4 w-4 rounded accent-neutral-800 dark:accent-neutral-200"
                />
                <span className="text-neutral-800 dark:text-neutral-200">{option.label}</span>
              </label>
            ))}
          </div>
          {props.description ? (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</span>
          ) : null}
        </fieldset>
      );
    }
    case "radio": {
      const options = toOptions(props.options);
      const current = stringify(value);
      return (
        <fieldset className="flex min-w-0 flex-col gap-1 text-sm" disabled={bool(props.disabled)}>
          {props.label ? (
            <legend className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">
              {stringify(props.label)}
            </legend>
          ) : null}
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2">
              <input
                type="radio"
                name={controlId}
                value={option.value}
                checked={current === option.value}
                onChange={() => set(coerceOption(option.value, props.options))}
                className="accent-neutral-800 dark:accent-neutral-200"
              />
              <span className="text-neutral-800 dark:text-neutral-200">{option.label}</span>
            </label>
          ))}
          {props.description ? (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{stringify(props.description)}</span>
          ) : null}
        </fieldset>
      );
    }
    case "toggle":
      return (
        <HeadlessField disabled={bool(props.disabled)} className="flex min-w-0 flex-col gap-1.5 text-sm">
          <div className="flex items-center gap-3">
            <Switch
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
    case "button":
      return <Button props={props} context={context} extra={extra} />;
    default:
      return null;
  }
}

export const UiNodeView = memo(function UiNodeView({ node }: { node: UiNode }) {
  const context = useContext(UiContext);
  const extra = useContext(IterationContext);
  const snapshot = useSelector(context?.runtime.scope ?? EMPTY_SCOPE);
  if (!context) return null;
  if (node.type === "error") {
    // A component cut off mid-stream is not a mistake yet.
    if (context.streaming) return null;
    return (
      <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {node.message}
      </p>
    );
  }
  const values = extra ? extendScope(snapshot.values, extra) : snapshot.values;
  const resolve = (value: unknown) => context.runtime.resolve(value, values);
  const condition = (value: unknown) => context.runtime.condition(value, values);
  if (node.visible !== undefined && !condition(node.visible)) return null;
  const props = resolveProps(node.type, node.props, resolve, condition);
  // Preview state is discarded as the source grows; only a finished fence
  // accepts input or dispatches actions.
  if (context.streaming && (node.bind || node.type === "button")) props.disabled = true;
  return <NodeContent node={node} props={props} values={values} context={context} extra={extra} />;
});

const EMPTY_SCOPE = { get: () => ({ values: {}, errors: {} }), subscribe: () => ({ unsubscribe: () => {} }) };
