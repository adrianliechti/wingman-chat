import type { Tool } from "@/shared/types/chat";

/** Published provider ceiling for nullable/union parameters in strict tools. */
export const MAX_STRICT_SCHEMA_UNIONS = 16;

/**
 * Defensive aggregate ceiling. Some providers reject a broad strict toolbox
 * even when it contains no unions, so compile only a bounded subset strictly.
 */
export const MAX_STRICT_TOOL_SCHEMAS = 8;

export function countSchemaUnions(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.reduce((total, item) => total + countSchemaUnions(item), 0);

  const schema = value as Record<string, unknown>;
  const here = Array.isArray(schema.type) || Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf) ? 1 : 0;
  return here + Object.values(schema).reduce<number>((total, item) => total + countSchemaUnions(item), 0);
}

export interface StrictToolSchemaPlan {
  strict: boolean[];
  compiledTools: number;
  unionParameters: number;
}

/**
 * Select the requested strict schemas that fit the portable provider budget.
 * Overflow tools still keep their JSON Schema, but are sent as schema-guided
 * (`strict: false`) and rely on the harness's defensive argument validation.
 */
export function planStrictToolSchemas(tools: readonly Pick<Tool, "parameters" | "strict">[]): StrictToolSchemaPlan {
  let compiledTools = 0;
  let unionParameters = 0;
  const strict = tools.map((tool) => {
    if (tool.strict !== true) return false;

    const toolUnions = countSchemaUnions(tool.parameters);
    if (compiledTools >= MAX_STRICT_TOOL_SCHEMAS || unionParameters + toolUnions > MAX_STRICT_SCHEMA_UNIONS) {
      return false;
    }

    compiledTools += 1;
    unionParameters += toolUnions;
    return true;
  });

  return { strict, compiledTools, unionParameters };
}
