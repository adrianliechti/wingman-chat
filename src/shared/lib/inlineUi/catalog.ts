import {
  ActionSchema,
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  Catalog,
  CheckRuleSchema,
  ChildListSchema,
  DynamicBooleanSchema,
  DynamicNumberSchema,
  DynamicStringSchema,
  DynamicStringListSchema,
  DynamicValueSchema,
  DataBindingSchema,
  FunctionCallSchema,
  type ComponentApi,
  type FunctionImplementation,
  type FunctionInvoker,
} from "@a2ui/web_core/v1_0";
// web_core's schema introspector uses Zod 3. Keep this boundary explicit.
import { z } from "zod-a2ui";
import { evaluate, type Scope } from "./expression.ts";

export const A2UI_VERSION = "v1.0" as const;
export const A2UI_SDK_VERSION = "0.13.0";
export const BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";
export const WINGMAN_CATALOG_ID = "urn:wingman:inline-ui:catalog:1";
const string = DynamicStringSchema.describe("REF:#/$defs/DynamicString");
const number = DynamicNumberSchema.describe("REF:#/$defs/DynamicNumber");
const boolean = DynamicBooleanSchema.describe("REF:#/$defs/DynamicBoolean");
const value = DynamicValueSchema.describe("REF:#/$defs/DynamicValue");
const dynamic = <T extends z.ZodTypeAny>(literal: T) =>
  z.union([
    literal,
    DataBindingSchema.describe("REF:#/$defs/DataBinding"),
    FunctionCallSchema.describe("REF:#/$defs/FunctionCall"),
  ]);
const rows = dynamic(z.array(z.record(value)).max(10000));
const strings = DynamicStringListSchema.describe("REF:#/$defs/DynamicStringList");
const children = ChildListSchema.describe("REF:#/$defs/ChildList");
const action = ActionSchema.describe("REF:#/$defs/Action");
const checks = z.array(CheckRuleSchema).max(20).optional();
const format = z.enum(["number", "integer", "currency", "percent", "compact", "text"]).optional();
const common = { visible: boolean.optional(), disabled: boolean.optional(), weight: z.number().optional() };
const control = { label: string.optional(), description: string.optional(), checks };
const options = z.array(z.object({ value: z.string(), label: string }).strict()).max(500);
const item = z.object({ label: string, time: value.optional(), description: string.optional() }).strict();
const numericFormat = { format, currency: string.optional(), digits: number.optional() };

function component<const Name extends string, Props extends z.ZodRawShape>(name: Name, props: Props) {
  return { name, schema: z.object({ ...common, ...props }).strict() };
}

/** Native Wingman presentation types; state and actions are resolved by A2UI. */
export const WINGMAN_COMPONENTS = [
  component("Grid", { columns: number.optional(), gap: z.enum(["none", "sm", "md", "lg"]).optional(), children }),
  component("Collapsible", {
    title: string,
    description: string.optional(),
    defaultOpen: boolean.optional(),
    children,
  }),
  component("Heading", { text: string, level: number.optional() }),
  component("Metric", {
    label: string,
    value,
    ...numericFormat,
    unit: string.optional(),
    delta: number.optional(),
    deltaLabel: string.optional(),
    description: string.optional(),
  }),
  component("Callout", {
    text: string,
    title: string.optional(),
    tone: z.enum(["info", "success", "warning", "error"]).optional(),
  }),
  component("Badge", { text: string, tone: z.enum(["neutral", "info", "success", "warning", "error"]).optional() }),
  component("Code", { text: string, language: string.optional() }),
  component("Progress", { value: number, max: number.optional(), label: string.optional(), format }),
  component("Svg", { markup: string, height: number.optional(), label: string.optional() }),
  component("Link", {
    text: string,
    href: string,
    description: string.optional(),
    kind: z.enum(["link", "chip"]).optional(),
  }),
  component("Html", { markup: string, height: number.optional(), title: string.optional() }),
  component("Timeline", {
    items: dynamic(z.array(z.union([z.string(), item])).max(200)),
    active: dynamic(z.union([z.string(), z.number()])).optional(),
  }),
  component("KeyValue", {
    items: dynamic(z.array(z.object({ label: string, value }).strict()).max(100)),
    columns: number.optional(),
  }),
  component("TextList", { items: dynamic(z.array(string).max(500)), ordered: boolean.optional() }),
  component("Table", {
    rows,
    columns: z
      .array(
        z
          .object({
            key: z.string(),
            label: string.optional(),
            align: z.enum(["start", "center", "end"]).optional(),
            ...numericFormat,
          })
          .strict(),
      )
      .optional(),
    sortable: boolean.optional(),
    pageSize: number.optional(),
    emptyText: string.optional(),
    caption: string.optional(),
  }),
  component("Chart", {
    kind: z.enum(["line", "area", "bar", "pie", "donut", "scatter"]),
    data: rows,
    x: z.string().optional(),
    y: z.string().optional(),
    series: z.array(z.union([z.string(), z.object({ key: z.string(), label: string.optional() }).strict()])).optional(),
    title: string.optional(),
    stacked: boolean.optional(),
    horizontal: boolean.optional(),
    height: number.optional(),
    format,
    currency: string.optional(),
    xLabel: string.optional(),
    yLabel: string.optional(),
    caption: string.optional(),
  }),
  component("Select", { ...control, value: string, options }),
  component("MultiSelect", { ...control, value: strings, options }),
  component("Segmented", { ...control, value: string, options }),
  component("Radio", { ...control, value: string, options }),
  component("Toggle", { ...control, value: boolean }),
  component("Stepper", {
    ...control,
    value: number,
    min: number.optional(),
    max: number.optional(),
    step: number.optional(),
    unit: string.optional(),
  }),
  component("Checklist", { ...control, value: strings, items: z.array(z.union([z.string(), item])) }),
  component("Form", { children, action, submit: string, checks }),
] satisfies ComponentApi[];

export const WINGMAN_FUNCTIONS: FunctionImplementation[] = [
  {
    name: "evaluate",
    returnType: "any",
    allowedCallers: "rendererOrAgent",
    description:
      "Evaluate a restricted Wingman arithmetic/collection expression using explicitly bound variables. No JavaScript, globals, or side effects.",
    schema: z.object({ expression: z.string().max(4000), values: value }).strict(),
    execute: (args) => evaluate(String(args.expression), args.values as Scope),
  },
  {
    name: "setValue",
    returnType: "void",
    requiresUserActivation: true,
    allowedCallers: "rendererOnly",
    description: "Set a JSON Pointer to a value after a user action. Use '/' with an object to reset the data model.",
    schema: z.object({ path: z.string(), value }).strict(),
    execute: (args, context) => {
      context.set(String(args.path), args.value);
    },
  },
  {
    name: "copyText",
    returnType: "void",
    requiresUserActivation: true,
    allowedCallers: "rendererOnly",
    description: "Copy text to the clipboard after a user action.",
    schema: z.object({ text: string }).strict(),
    execute: async (args) => {
      await navigator.clipboard.writeText(String(args.text));
    },
  },
];

/**
 * SDK 0.13.0 revalidates resolved logical operands against the wire boolean
 * schema, rejecting its own ValidationResult objects. Normalize only those
 * execution-time operands; the published wire schemas remain unchanged.
 * Remove this adapter when the upstream invoker accepts ValidationResult.
 */
class BasicCatalog extends Catalog<ComponentApi> {
  declare readonly invoker: FunctionInvoker;
  constructor() {
    super(BASIC_CATALOG_ID, A2UI_VERSION, BASIC_COMPONENTS, BASIC_FUNCTIONS);
    const invoke = (this as Catalog<ComponentApi>).invoker;
    const operand = (value: unknown) =>
      value && typeof value === "object" && "valid" in value && typeof value.valid === "boolean" ? value.valid : value;
    this.invoker = (name, args, context, abortSignal) => {
      if ((name === "and" || name === "or") && Array.isArray(args.values))
        args = { ...args, values: args.values.map(operand) };
      if (name === "not") args = { ...args, value: operand(args.value) };
      return invoke(name, args, context, abortSignal);
    };
  }
}

export const basicCatalog = new BasicCatalog();
export const wingmanCatalog = new Catalog(WINGMAN_CATALOG_ID, A2UI_VERSION, WINGMAN_COMPONENTS, WINGMAN_FUNCTIONS);
export const catalogs = [basicCatalog, wingmanCatalog];
