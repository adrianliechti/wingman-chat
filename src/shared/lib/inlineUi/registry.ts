import { basicCatalog, wingmanCatalog, A2UI_SDK_VERSION, A2UI_VERSION } from "./catalog.ts";
import { HELPER_NAMES } from "./expression.ts";

type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
};

interface ReferenceSelection {
  components?: readonly string[];
  functions?: readonly string[];
}

interface ReferenceGroup {
  path: string;
  basic?: ReferenceSelection;
  wingman?: ReferenceSelection;
  expressions?: boolean;
}

/** Each API lives in one lookup file; coverage tests require an explicit home for new APIs. */
export const REFERENCE_GROUPS: Record<string, ReferenceGroup> = {
  protocol: {
    path: "references/protocol.md",
    basic: { functions: ["openUrl"] },
    wingman: { functions: ["setValue", "copyText"] },
  },
  layout: {
    path: "references/layout.md",
    basic: {
      components: [
        "Row",
        "Column",
        "List",
        "Card",
        "Tabs",
        "Modal",
        "Divider",
        "Text",
        "Image",
        "Icon",
        "Video",
        "AudioPlayer",
      ],
    },
    wingman: {
      components: ["Grid", "Collapsible", "Heading", "Callout", "Badge", "Code", "Svg", "Link", "Html", "TextList"],
    },
  },
  controls: {
    path: "references/controls.md",
    basic: {
      components: ["Button", "TextField", "CheckBox", "ChoicePicker", "Slider", "DateTimeInput"],
      functions: ["required", "email", "regex", "length", "numeric"],
    },
    wingman: { components: ["Select", "MultiSelect", "Segmented", "Radio", "Toggle", "Stepper", "Checklist", "Form"] },
  },
  data: {
    path: "references/data.md",
    wingman: { components: ["Metric", "Progress", "Timeline", "KeyValue", "Table", "Chart"] },
  },
  functions: {
    path: "references/functions.md",
    basic: {
      functions: ["formatString", "formatNumber", "formatCurrency", "formatDate", "pluralize", "and", "or", "not"],
    },
    wingman: { functions: ["evaluate"] },
    expressions: true,
  },
};

function syntax(schema: JsonSchema, omit: readonly string[] = []): string {
  if (schema.$ref) return schema.$ref.split("/").at(-1) ?? "value";
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join("|");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.allOf)
    return (
      schema.allOf
        .map((item) => syntax(item))
        .filter((value) => value !== "JSON")
        .join(" & ") || "JSON"
    );
  if (schema.type === "array") {
    const item = syntax(schema.items ?? {});
    return `${item.includes("|") ? `(${item})` : item}[]`;
  }
  if (schema.properties) {
    const alternatives = schema.anyOf ?? schema.oneOf;
    const requirements = alternatives?.every((item) => item.required && Object.keys(item).length === 1)
      ? ` (requires ${alternatives.map((item) => item.required!.join(" and ")).join(" or ")})`
      : "";
    return `{ ${Object.entries(schema.properties)
      .filter(([key]) => !omit.includes(key))
      .map(([key, prop]) => `${key}${schema.required?.includes(key) ? "" : "?"}: ${syntax(prop)}`)
      .join(", ")} }${requirements}`;
  }
  if (schema.anyOf || schema.oneOf) return (schema.anyOf ?? schema.oneOf ?? []).map((item) => syntax(item)).join("|");
  if (Array.isArray(schema.type)) return schema.type.join("|");
  return schema.type ?? "JSON";
}

export function componentReference(group: ReferenceGroup): string {
  const sections = [`A2UI ${A2UI_VERSION}; SDK ${A2UI_SDK_VERSION}. Generated signatures; \`?\` means optional.`];
  for (const [key, catalog] of [
    ["basic", basicCatalog],
    ["wingman", wingmanCatalog],
  ] as const) {
    const selected = group[key];
    if (!selected) continue;
    const schema = catalog.validationSchema as {
      components: Record<string, JsonSchema>;
      functions: Record<string, JsonSchema>;
    };
    sections.push(`\n### ${key === "basic" ? "Basic" : "Wingman"} catalog\n\n\`catalogId: "${catalog.id}"\``);
    // Factor shared properties out instead of repeating them on every component.
    const shared = key === "basic" ? ["weight"] : ["visible", "disabled", "weight"];
    const names = selected.components ?? [];
    if (names.length) {
      const first = schema.components[names[0]];
      sections.push(
        `\nEvery component also accepts ${syntax({
          properties: Object.fromEntries(shared.map((name) => [name, first.properties![name]])),
          required: first.required,
        })}.\n`,
      );
    }
    if (key === "basic" && names.length)
      sections.push("`visible` and `disabled` are Wingman-only properties; Basic components reject them.\n");
    for (const name of names) {
      if (!schema.components[name]) throw new Error(`Unknown ${key} component ${name}`);
      sections.push(`- ${name} ${syntax(schema.components[name], ["id", "component", ...shared])}`);
    }
    if (selected.functions?.length) sections.push("\nFunctions:\n");
    for (const name of selected.functions ?? []) {
      const fn = catalog.functions.get(name);
      if (!fn || !schema.functions[name]) throw new Error(`Unknown ${key} function ${name}`);
      sections.push(
        `- ${name} ${syntax(schema.functions[name].properties!.args)}: ${fn.returnType}${fn.requiresUserActivation ? " (user action only)" : ""}`,
      );
    }
  }
  if (group.expressions) {
    const definitions = basicCatalog.validationSchema.$defs as Record<string, JsonSchema>;
    sections.push(
      `\n### System functions\n\n- @index ${syntax(definitions.IndexSystemFunction.properties!.args)}: number (list templates only; omit catalogId)`,
      `\nExpression helpers: ${HELPER_NAMES.join(", ")}.`,
    );
  }
  return sections.join("\n");
}

export const REFERENCE_START = "<!-- A2UI-CATALOG:START -->";
export const REFERENCE_END = "<!-- A2UI-CATALOG:END -->";
export function updateComponentReference(source: string, group: ReferenceGroup): string {
  const start = source.indexOf(REFERENCE_START),
    end = source.indexOf(REFERENCE_END);
  if (start === -1 || end < start) throw new Error("Missing A2UI catalog reference markers");
  return source.slice(0, start + REFERENCE_START.length) + "\n" + componentReference(group) + "\n" + source.slice(end);
}

/** Publish catalog identity alongside the SDK-generated contract. */
export function publishedCatalog(catalog: typeof basicCatalog | typeof wingmanCatalog) {
  return { ...catalog.validationSchema, $id: catalog.id, protocolVersion: A2UI_VERSION };
}
