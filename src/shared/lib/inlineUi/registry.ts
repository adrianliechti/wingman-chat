import { basicCatalog, wingmanCatalog, A2UI_SDK_VERSION, A2UI_VERSION } from "./catalog.ts";
import { HELPER_NAMES } from "./expression.ts";

type JsonSchema = {
  $ref?: string;
  type?: string;
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
function syntax(schema: JsonSchema): string {
  if (schema.$ref) return schema.$ref.split("/").at(-1) ?? "value";
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join("|");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.anyOf || schema.oneOf) return (schema.anyOf ?? schema.oneOf ?? []).map(syntax).join("|");
  if (schema.allOf) return schema.allOf.map(syntax).join(" & ");
  if (schema.type === "array") return `${syntax(schema.items ?? {})}[]`;
  if (schema.properties)
    return `{ ${Object.entries(schema.properties)
      .filter(([key]) => !["id", "component"].includes(key))
      .map(([key, prop]) => `${key}${schema.required?.includes(key) ? "" : "?"}: ${syntax(prop)}`)
      .join(", ")} }`;
  return schema.type ?? "JSON";
}

export function componentReference(): string {
  const sections = [
    `A2UI ${A2UI_VERSION}; SDK ${A2UI_SDK_VERSION}. Components use a flat list with unique id and component fields. Child values are component IDs, never nested components.`,
  ];
  for (const catalog of [basicCatalog, wingmanCatalog]) {
    const schema = catalog.catalogSchema as {
      components: Record<string, JsonSchema>;
      functions: Record<string, JsonSchema>;
    };
    sections.push(`Catalog: ${catalog.id}`);
    for (const [name, props] of Object.entries(schema.components)) sections.push(`- ${name} ${syntax(props)}`);
    sections.push("Functions:");
    for (const [name, fn] of catalog.functions)
      sections.push(
        `- ${name} ${syntax(schema.functions[name] ?? {})}: ${fn.returnType}${fn.requiresUserActivation ? " (user action only)" : ""}`,
      );
  }
  sections.push(
    `Wingman evaluate(expression, values) helpers: ${HELPER_NAMES.join(", ")}. Variables come only from the values argument; bind dependencies explicitly using @path.`,
  );
  return sections.join("\n");
}

export const REFERENCE_START = "<!-- A2UI-CATALOG:START -->";
export const REFERENCE_END = "<!-- A2UI-CATALOG:END -->";
export function updateComponentReference(source: string): string {
  const start = source.indexOf(REFERENCE_START),
    end = source.indexOf(REFERENCE_END);
  if (start === -1 || end < start) throw new Error("Missing A2UI catalog reference markers");
  return source.slice(0, start + REFERENCE_START.length) + "\n" + componentReference() + "\n" + source.slice(end);
}

/** Publish catalog identity alongside the SDK-generated contract. */
export function publishedCatalog(catalog: typeof basicCatalog | typeof wingmanCatalog) {
  return { ...catalog.catalogSchema, $id: catalog.id, protocolVersion: A2UI_VERSION };
}
