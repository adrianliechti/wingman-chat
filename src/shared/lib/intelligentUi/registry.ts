/**
 * A machine-readable description of the Intelligent UI language, derived from
 * the Zod registry in `schema.ts` so it can never drift from what the
 * validator accepts. It is the contract other things are checked against: the
 * skill reference and the chat prompt must mention every component and helper
 * (see `registry.test.ts`), and tooling can list or diff the language.
 */

import type { z } from "zod";
import { HELPER_NAMES } from "./expression";
import { type ComponentDefinition, COMPONENTS, type ComponentType, NUMBER_FORMATS } from "./schema";

export interface PropDescription {
  /** `number`, `string`, `boolean`, `array`, `object`, `enum`, `json` or a union joined with `|`. */
  type: string;
  optional: boolean;
  /** Allowed values of an enum prop. */
  values?: string[];
  /** Whether the prop may be a `{{ }}` template instead of a literal. */
  template: boolean;
}

export interface ComponentDescription {
  category: "layout" | "content" | "data" | "control" | "action";
  children: "nodes" | "none";
  bind: boolean;
  props: Record<string, PropDescription>;
}

export interface UiRegistry {
  components: Record<ComponentType, ComponentDescription>;
  helpers: string[];
  actions: string[];
  formats: string[];
}

const CATEGORY: Record<ComponentType, ComponentDescription["category"]> = {
  column: "layout",
  row: "layout",
  grid: "layout",
  card: "layout",
  tabs: "layout",
  divider: "layout",
  each: "layout",
  heading: "content",
  text: "content",
  metric: "content",
  callout: "content",
  badge: "content",
  code: "content",
  progress: "content",
  image: "content",
  svg: "content",
  icon: "content",
  link: "content",
  html: "content",
  form: "layout",
  timeline: "content",
  keyvalue: "content",
  list: "content",
  table: "data",
  chart: "data",
  slider: "control",
  input: "control",
  select: "control",
  multiselect: "control",
  segmented: "control",
  stepper: "control",
  checklist: "control",
  radio: "control",
  toggle: "control",
  button: "action",
};

type AnySchema = z.ZodType & { def: Record<string, unknown> };

/** Flatten a Zod type into a readable type name, unwrapping optionals and unions. */
function describeType(schema: AnySchema): { type: string; values?: string[]; template: boolean } {
  const def = schema.def;
  switch (def.type) {
    case "optional":
    case "nullable":
    case "default":
      return describeType(def.innerType as AnySchema);
    case "union": {
      const parts = (def.options as AnySchema[]).map(describeType);
      const template = parts.some((part) => part.template);
      const names = [...new Set(parts.map((part) => part.type).filter((name) => name !== "string" || !template))];
      const values = parts.flatMap((part) => part.values ?? []);
      return { type: names.join("|") || "string", ...(values.length ? { values } : {}), template };
    }
    case "enum":
      return { type: "enum", values: Object.values(def.entries as Record<string, string>), template: false };
    case "literal":
      return { type: "enum", values: (def.values as unknown[]).map(String), template: false };
    case "string":
      return { type: "string", template: true };
    case "number":
      return { type: "number", template: false };
    case "boolean":
      return { type: "boolean", template: false };
    case "null":
      return { type: "null", template: false };
    case "array":
      return { type: "array", template: false };
    case "object":
    case "record":
      return { type: "object", template: false };
    case "lazy":
    case "unknown":
    case "any":
      return { type: "json", template: false };
    default:
      return { type: String(def.type), template: false };
  }
}

function describeProps(shape: Record<string, z.ZodType>): Record<string, PropDescription> {
  const props: Record<string, PropDescription> = {};
  for (const [name, schema] of Object.entries(shape)) {
    const typed = schema as AnySchema;
    const optional = typed.def.type === "optional";
    props[name] = { ...describeType(typed), optional };
  }
  return props;
}

export function describeRegistry(): UiRegistry {
  const components = {} as Record<ComponentType, ComponentDescription>;
  for (const [name, definition] of Object.entries(COMPONENTS) as [ComponentType, ComponentDefinition][]) {
    const type = name;
    components[type] = {
      category: CATEGORY[type],
      children: definition.children ? "nodes" : "none",
      bind: !!definition.bind,
      props: describeProps(definition.props.shape as Record<string, z.ZodType>),
    };
  }
  return {
    components,
    helpers: [...HELPER_NAMES].sort(),
    actions: ["set", "reset", "send", "copy", "open"],
    formats: [...NUMBER_FORMATS],
  };
}
