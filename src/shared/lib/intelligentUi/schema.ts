/**
 * The Intelligent UI document schema: a renderer-independent JSON tree the
 * model emits in a ```ui fence. Every component type and its props are
 * declared here with Zod, so a generated document is validated before anything
 * renders. Unknown components become inline error nodes (the rest of the
 * document still renders); unknown props are dropped; a document that is not
 * an object with children fails as a whole and the host falls back to text.
 *
 * Any string prop may be a template (`"{{ expr }}"`), so numeric and boolean
 * props also accept strings. Templates are resolved at render time against the
 * document's state and computed values (see `expression.ts`).
 */

import { z } from "zod";
import { isTemplate, type JsonValue, referencedIdentifiers } from "./expression";
import { completePartialJson, parseLooseJson } from "./looseJson";

export const UI_FENCE_LANGUAGES = new Set(["ui", "wingman-ui", "intelligent-ui", "iui"]);

// ── Shared prop primitives ─────────────────────────────────────────────────

const num = z.union([z.number(), z.string()]);
const bool = z.union([z.boolean(), z.string()]);
const str = z.string();
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);
/** An array prop, or a template that resolves to one. */
const list = <T extends z.ZodTypeAny>(item: T) => z.union([z.array(item), z.string()]);

const option = z.union([
  z.string(),
  z.number(),
  z.object({ value: z.union([z.string(), z.number(), z.boolean()]), label: z.string().optional() }),
]);

export const NUMBER_FORMATS = ["number", "integer", "currency", "percent", "compact", "text"] as const;
const format = z.enum(NUMBER_FORMATS);
const gap = z.enum(["none", "sm", "md", "lg"]);

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * What a button may do. State actions (`set`, `reset`) run entirely inside the
 * document. `send` hands a message to the chat as a normal user turn, so the
 * model, not the document, decides what happens next. `copy` and `open` act on
 * the viewer's clipboard/browser after their click. No action can call a tool,
 * fetch a URL, or write to the workspace directly.
 */
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set"), values: z.record(z.string(), jsonValue) }),
  z.object({ type: z.literal("reset"), keys: z.array(z.string()).optional() }),
  z.object({ type: z.literal("send"), message: z.string(), context: z.boolean().optional() }),
  z.object({ type: z.literal("copy"), text: z.string() }),
  z.object({ type: z.literal("open"), url: z.string() }),
]);

export type UiAction = z.infer<typeof actionSchema>;

/** Accept `{ "set": {...} }`, `{ "send": "..." }`, `"reset"`, or the explicit `{ type }` form. */
function normalizeAction(raw: unknown): unknown {
  if (typeof raw === "string") return raw === "reset" ? { type: "reset" } : { type: "send", message: raw };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  if (typeof record.type === "string") return record;
  if (record.set && typeof record.set === "object") return { type: "set", values: record.set };
  if ("reset" in record) return { type: "reset", ...(Array.isArray(record.reset) ? { keys: record.reset } : {}) };
  if (typeof record.send === "string") {
    return { type: "send", message: record.send, ...(record.context === true ? { context: true } : {}) };
  }
  if (typeof record.copy === "string") return { type: "copy", text: record.copy };
  if (typeof record.open === "string") return { type: "open", url: record.open };
  return record;
}

const actions = z.preprocess(
  (raw) => (Array.isArray(raw) ? raw.map(normalizeAction) : [normalizeAction(raw)]),
  z.array(actionSchema),
);

// ── Component registry ─────────────────────────────────────────────────────

const column = z.object({ gap: gap.optional(), align: z.enum(["start", "center", "end", "stretch"]).optional() });
const row = z.object({
  gap: gap.optional(),
  wrap: bool.optional(),
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
  justify: z.enum(["start", "center", "end", "between"]).optional(),
});
const grid = z.object({ columns: num.optional(), gap: gap.optional() });
const card = z.object({ title: str.optional(), description: str.optional() });
const divider = z.object({});
const tabs = z.object({ items: z.array(z.object({ label: str, children: z.array(z.unknown()) })).min(1) });

const heading = z.object({ text: str, level: num.optional() });
const text = z.object({
  text: str,
  tone: z.enum(["default", "muted", "accent"]).optional(),
  size: z.enum(["sm", "md", "lg"]).optional(),
  align: z.enum(["start", "center", "end"]).optional(),
});
const metric = z.object({
  label: str,
  value: z.union([z.number(), z.string(), z.boolean(), z.null()]),
  format: format.optional(),
  currency: str.optional(),
  digits: num.optional(),
  unit: str.optional(),
  delta: z.union([z.number(), z.string()]).optional(),
  deltaLabel: str.optional(),
  description: str.optional(),
});
const callout = z.object({
  tone: z.enum(["info", "success", "warning", "error"]).optional(),
  title: str.optional(),
  text: str,
});
const progress = z.object({ label: str.optional(), value: num, max: num.optional(), format: format.optional() });
const image = z.object({ src: str, alt: str.optional(), caption: str.optional() });
const svg = z.object({ markup: str, height: num.optional(), label: str.optional() });
const keyvalue = z.object({
  items: list(z.object({ label: str, value: z.union([z.string(), z.number(), z.boolean(), z.null()]) })),
  columns: num.optional(),
});
const timeline = z.object({
  items: list(
    z.union([
      z.string(),
      z.object({ label: str, time: z.union([z.string(), z.number()]).optional(), description: str.optional() }),
    ]),
  ),
  /** Index (number) or label of the current step; earlier steps show as done. */
  active: z.union([z.number(), z.string()]).optional(),
});
const listComponent = z.object({
  items: list(z.union([z.string(), z.number(), z.object({ label: str, value: z.unknown().optional() })])),
  ordered: bool.optional(),
});

const tableColumn = z.object({
  key: z.union([z.string(), z.number()]),
  label: str.optional(),
  align: z.enum(["start", "center", "end"]).optional(),
  format: format.optional(),
  currency: str.optional(),
  digits: num.optional(),
});
const table = z.object({
  columns: z.array(tableColumn).optional(),
  rows: list(z.unknown()),
  sortable: bool.optional(),
  pageSize: num.optional(),
  emptyText: str.optional(),
});

const chartSeries = z.union([z.string(), z.object({ key: str, label: str.optional() })]);
const chart = z.object({
  kind: z.enum(["line", "area", "bar", "pie", "donut", "scatter"]),
  data: list(z.unknown()),
  x: str.optional(),
  y: str.optional(),
  series: z.array(chartSeries).optional(),
  title: str.optional(),
  stacked: bool.optional(),
  horizontal: bool.optional(),
  height: num.optional(),
  format: format.optional(),
  currency: str.optional(),
  xLabel: str.optional(),
  yLabel: str.optional(),
});

const control = {
  label: str.optional(),
  description: str.optional(),
  disabled: bool.optional(),
};
const slider = z.object({
  ...control,
  min: num.optional(),
  max: num.optional(),
  step: num.optional(),
  format: format.optional(),
  currency: str.optional(),
  digits: num.optional(),
  unit: str.optional(),
});
const input = z.object({
  ...control,
  kind: z.enum(["text", "number", "multiline"]).optional(),
  placeholder: str.optional(),
  min: num.optional(),
  max: num.optional(),
  step: num.optional(),
});
const select = z.object({ ...control, options: list(option), placeholder: str.optional() });
const multiselect = z.object({ ...control, options: list(option), columns: num.optional() });
const stepper = z.object({
  ...control,
  min: num.optional(),
  max: num.optional(),
  step: num.optional(),
  unit: str.optional(),
});
const checklist = z.object({
  ...control,
  items: list(
    z.union([
      z.string(),
      z.object({ label: str, time: z.union([z.string(), z.number()]).optional(), description: str.optional() }),
    ]),
  ),
});
const segmented = z.object({ ...control, options: list(option) });
const radio = z.object({ ...control, options: list(option) });
const toggle = z.object({ ...control });
const button = z.object({
  label: str,
  action: actions,
  variant: z.enum(["primary", "secondary", "ghost", "danger"]).optional(),
  disabled: bool.optional(),
  confirm: str.optional(),
});

export interface ComponentDefinition {
  props: z.ZodObject;
  /** Whether the component lays out nested children. */
  children?: boolean;
  /** Whether the component reads and writes a state key through `bind`. */
  bind?: boolean;
}

export const COMPONENTS = {
  column: { props: column, children: true },
  row: { props: row, children: true },
  grid: { props: grid, children: true },
  card: { props: card, children: true },
  tabs: { props: tabs },
  divider: { props: divider },
  heading: { props: heading },
  text: { props: text },
  metric: { props: metric },
  callout: { props: callout },
  progress: { props: progress },
  image: { props: image },
  svg: { props: svg },
  timeline: { props: timeline },
  keyvalue: { props: keyvalue },
  list: { props: listComponent },
  table: { props: table },
  chart: { props: chart },
  slider: { props: slider, bind: true },
  input: { props: input, bind: true },
  select: { props: select, bind: true },
  multiselect: { props: multiselect, bind: true },
  segmented: { props: segmented, bind: true },
  stepper: { props: stepper, bind: true },
  checklist: { props: checklist, bind: true },
  radio: { props: radio, bind: true },
  toggle: { props: toggle, bind: true },
  button: { props: button },
} as const satisfies Record<string, ComponentDefinition>;

export type ComponentType = keyof typeof COMPONENTS;
export const COMPONENT_TYPES = Object.keys(COMPONENTS) as ComponentType[];

const ALIASES: Record<string, ComponentType> = {
  col: "column",
  stack: "column",
  vstack: "column",
  hstack: "row",
  section: "card",
  panel: "card",
  separator: "divider",
  hr: "divider",
  title: "heading",
  paragraph: "text",
  markdown: "text",
  label: "text",
  stat: "metric",
  kpi: "metric",
  alert: "callout",
  note: "callout",
  banner: "callout",
  progressbar: "progress",
  img: "image",
  drawing: "svg",
  steps: "timeline",
  details: "keyvalue",
  summary: "keyvalue",
  facts: "keyvalue",
  definitionlist: "keyvalue",
  counter: "stepper",
  numberstepper: "stepper",
  tasks: "checklist",
  todo: "checklist",
  schedule: "timeline",
  diagram: "svg",
  chips: "segmented",
  pills: "segmented",
  segment: "segmented",
  togglegroup: "segmented",
  buttongroup: "segmented",
  datatable: "table",
  graph: "chart",
  range: "slider",
  textfield: "input",
  textarea: "input",
  number: "input",
  dropdown: "select",
  multiselect: "multiselect",
  checkboxes: "multiselect",
  checkboxgroup: "multiselect",
  checklist: "multiselect",
  radiogroup: "radio",
  checkbox: "toggle",
  switch: "toggle",
  btn: "button",
};

export function resolveComponentType(type: unknown): ComponentType | undefined {
  if (typeof type !== "string") return undefined;
  const key = type
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (Object.hasOwn(COMPONENTS, key)) return key as ComponentType;
  return ALIASES[key];
}

// ── Normalized tree ────────────────────────────────────────────────────────

export type UiProps = Record<string, unknown>;

export type UiNode =
  | {
      type: ComponentType;
      props: UiProps;
      bind?: string;
      visible?: string | boolean;
      children: UiNode[];
      /** Tabs keep their children per item. */
      tabs?: { label: string; children: UiNode[] }[];
    }
  | { type: "error"; message: string };

export interface UiDocument {
  title?: string;
  state: Record<string, JsonValue>;
  computed: { key: string; expression: string }[];
  children: UiNode[];
}

const RESERVED_NODE_KEYS = new Set(["type", "props", "bind", "visible", "children", "key", "id"]);

const MAX_NODES = 2_000;
const MAX_NODE_DEPTH = 32;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "props"}: ${issue.message}`)
    .join("; ");
}

interface Budget {
  nodes: number;
}

export function normalizeNode(raw: unknown, budget: Budget = { nodes: 0 }, depth = 0): UiNode {
  if (++budget.nodes > MAX_NODES) return { type: "error", message: "Too many components" };
  if (depth > MAX_NODE_DEPTH) return { type: "error", message: "Components are nested too deeply" };
  if (typeof raw === "string") return { type: "text", props: { text: raw }, children: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { type: "error", message: "Each component must be an object with a type" };
  }
  const record = raw as Record<string, unknown>;
  const type = resolveComponentType(record.type);
  if (!type) {
    return { type: "error", message: `Unknown component "${typeof record.type === "string" ? record.type : "?"}"` };
  }
  const definition: ComponentDefinition = COMPONENTS[type];

  // Props may be nested under `props` or written flat on the node.
  const merged: UiProps = {};
  for (const [key, value] of Object.entries(record)) if (!RESERVED_NODE_KEYS.has(key)) merged[key] = value;
  if (record.props && typeof record.props === "object" && !Array.isArray(record.props)) {
    Object.assign(merged, record.props as UiProps);
  }
  // `text` children for text-like components ("text": "...") are already props;
  // but `{ "type": "heading", "children": "Title" }` is a common slip.
  if (typeof record.children === "string" && (type === "heading" || type === "text" || type === "button")) {
    merged[type === "button" ? "label" : "text"] ??= record.children;
  }
  if (type === "svg") {
    // The drawing may arrive under several names.
    merged.markup ??= merged.source ?? merged.svg ?? merged.content ?? merged.code;
  }
  if (type === "input" && typeof record.type === "string") {
    const lowered = record.type.toLowerCase();
    if (lowered === "number") merged.kind ??= "number";
    if (lowered === "textarea") merged.kind ??= "multiline";
  }

  const parsed = definition.props.safeParse(merged);
  if (!parsed.success) {
    return { type: "error", message: `Invalid ${type}: ${formatIssues(parsed.error)}` };
  }
  const props = parsed.data as UiProps;

  const bindRaw = record.bind ?? record.binding ?? record.model ?? merged.bind ?? merged.binding;
  const bind = typeof bindRaw === "string" && bindRaw.trim() ? bindRaw.trim() : undefined;
  if (definition.bind && !bind) {
    return { type: "error", message: `A ${type} needs a "bind" state key` };
  }

  const visible =
    typeof record.visible === "string" || typeof record.visible === "boolean"
      ? record.visible
      : typeof merged.visible === "string" || typeof merged.visible === "boolean"
        ? (merged.visible as string | boolean)
        : undefined;

  const children: UiNode[] =
    definition.children && Array.isArray(record.children)
      ? record.children.map((child) => normalizeNode(child, budget, depth + 1))
      : [];

  const node: UiNode = { type, props, bind: definition.bind ? bind : undefined, visible, children };
  if (type === "tabs") {
    const items = props.items as { label: string; children: unknown[] }[];
    node.tabs = items.map((item) => ({
      label: item.label,
      children: item.children.map((child) => normalizeNode(child, budget, depth + 1)),
    }));
  }
  return node;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export class UiDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UiDocumentError";
  }
}

/** Build a validated document from parsed JSON. Throws {@link UiDocumentError} when the root is unusable. */
export function normalizeDocument(raw: unknown): UiDocument {
  // A bare array is a list of children; a bare component is the root.
  if (Array.isArray(raw)) raw = { children: raw };
  if (!raw || typeof raw !== "object") throw new UiDocumentError("A UI document must be a JSON object");
  const record = raw as Record<string, unknown>;
  if (typeof record.type === "string" && !Array.isArray(record.children) && !("state" in record)) {
    raw = { children: [record] };
  } else if (typeof record.type === "string" && resolveComponentType(record.type)) {
    raw = { ...record, children: [record] };
  }
  const doc = raw as Record<string, unknown>;

  const childrenRaw = doc.children ?? doc.root ?? doc.body ?? doc.components;
  const childList = Array.isArray(childrenRaw) ? childrenRaw : childrenRaw ? [childrenRaw] : [];
  if (childList.length === 0) throw new UiDocumentError("A UI document needs at least one component in `children`");

  const state: Record<string, JsonValue> = {};
  const stateRaw = doc.state ?? doc.data ?? doc.initialState;
  if (stateRaw && typeof stateRaw === "object" && !Array.isArray(stateRaw)) {
    for (const [key, value] of Object.entries(stateRaw)) {
      if (!IDENTIFIER.test(key)) throw new UiDocumentError(`State key "${key}" must be a plain identifier`);
      const parsed = jsonValue.safeParse(value);
      if (!parsed.success) throw new UiDocumentError(`State key "${key}" must hold JSON data`);
      state[key] = parsed.data;
    }
  }

  const computed: UiDocument["computed"] = [];
  const computedRaw = doc.computed ?? doc.derived;
  if (computedRaw && typeof computedRaw === "object" && !Array.isArray(computedRaw)) {
    for (const [key, value] of Object.entries(computedRaw)) {
      if (!IDENTIFIER.test(key)) throw new UiDocumentError(`Computed key "${key}" must be a plain identifier`);
      if (typeof value !== "string") throw new UiDocumentError(`Computed "${key}" must be an expression string`);
      // Either a bare expression or a template; the runtime treats both the same way.
      computed.push({ key, expression: value });
    }
  }

  const budget: Budget = { nodes: 0 };
  return {
    title: typeof doc.title === "string" ? doc.title : undefined,
    state,
    computed,
    children: childList.map((child) => normalizeNode(child, budget)),
  };
}

export type ParseResult =
  | { status: "ok"; document: UiDocument }
  /** A streaming prefix that already parses: render it, expect more. */
  | { status: "partial"; document: UiDocument }
  | { status: "incomplete" }
  | { status: "error"; message: string };

/**
 * Parse fence text into a document. Text that is not yet valid JSON is
 * `incomplete` while it may still be streaming, so the host can show a
 * placeholder instead of an error.
 */
export function parseUiDocument(source: string, options: { streaming?: boolean } = {}): ParseResult {
  const trimmed = source.trim();
  if (!trimmed) return options.streaming ? { status: "incomplete" } : { status: "error", message: "Empty document" };
  let json: unknown;
  try {
    json = parseLooseJson(trimmed);
  } catch (error) {
    if (!options.streaming) {
      return { status: "error", message: error instanceof Error ? error.message : "Invalid JSON" };
    }
    // Still streaming: render whatever prefix is already complete.
    try {
      const completed = completePartialJson(trimmed);
      if (!completed) return { status: "incomplete" };
      return { status: "partial", document: normalizeDocument(parseLooseJson(completed)) };
    } catch {
      return { status: "incomplete" };
    }
  }
  try {
    return { status: "ok", document: normalizeDocument(json) };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

/** Every bound state key and every `set` target, for validation and reset. */
export function collectBindings(nodes: UiNode[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.type === "error") continue;
    if (node.bind) into.add(node.bind);
    collectBindings(node.children, into);
    if (node.tabs) for (const tab of node.tabs) collectBindings(tab.children, into);
  }
  return into;
}

// ── Reference validation ───────────────────────────────────────────────────

const ITERATION_NAMES = new Set(["item", "index", "key"]);

function templateExpressions(value: unknown, into: string[], depth = 0): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    if (isTemplate(value)) into.push(value);
    return;
  }
  if (Array.isArray(value)) for (const item of value) templateExpressions(item, into, depth + 1);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) templateExpressions(item, into, depth + 1);
  }
}

function nodeExpressions(nodes: UiNode[], into: string[]): void {
  for (const node of nodes) {
    if (node.type === "error") continue;
    if (typeof node.visible === "string") into.push(node.visible);
    for (const [key, value] of Object.entries(node.props)) {
      if (key === "disabled" && typeof value === "string") into.push(value);
      else templateExpressions(value, into);
    }
    nodeExpressions(node.children, into);
    if (node.tabs) for (const tab of node.tabs) nodeExpressions(tab.children, into);
  }
}

/**
 * Identifiers the document reads but never declares in `state` or `computed`,
 * such as a misspelled key. They evaluate to null at run time, so the
 * interface still renders; the warning tells the user and the model why a
 * value is blank. Nested helper expressions (`map(rows, 'v * 2')`) are not
 * inspected because they read item fields.
 */
export function collectUnresolvedReferences(document: UiDocument): string[] {
  const declared = new Set([...Object.keys(document.state), ...document.computed.map((entry) => entry.key)]);
  for (const key of collectBindings(document.children)) declared.add(key);
  const expressions: string[] = document.computed.map((entry) => entry.expression);
  nodeExpressions(document.children, expressions);
  const unresolved = new Set<string>();
  for (const expression of expressions) {
    for (const name of referencedIdentifiers(expression)) {
      if (!declared.has(name) && !ITERATION_NAMES.has(name)) unresolved.add(name);
    }
  }
  return [...unresolved].sort();
}
