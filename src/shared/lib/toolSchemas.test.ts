import { describe, expect, it } from "vitest";
import {
  MAX_STRICT_SCHEMA_UNIONS,
  MAX_STRICT_TOOL_SCHEMAS,
  countSchemaUnions,
  planStrictToolSchemas,
} from "./toolSchemas";

function tool(parameters: Record<string, unknown>, strict = true) {
  return { parameters, strict };
}

function nullableProperties(count: number): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`value_${index}`, { type: ["string", "null"] }]),
    ),
  };
}

describe("tool schema compatibility", () => {
  it("counts type arrays, anyOf, and oneOf recursively", () => {
    expect(
      countSchemaUnions({
        type: "object",
        properties: {
          first: { type: ["string", "null"] },
          second: { anyOf: [{ type: "string" }, { type: "null" }] },
          nested: { type: "array", items: { oneOf: [{ type: "number" }, { type: "null" }] } },
        },
      }),
    ).toBe(3);
  });

  it("caps aggregate strict-tool compilation while retaining schemas", () => {
    const tools = Array.from({ length: MAX_STRICT_TOOL_SCHEMAS + 2 }, () => tool({ type: "object", properties: {} }));
    const plan = planStrictToolSchemas(tools);

    expect(plan.compiledTools).toBe(MAX_STRICT_TOOL_SCHEMAS);
    expect(plan.strict).toEqual([...Array.from({ length: MAX_STRICT_TOOL_SCHEMAS }, () => true), false, false]);
  });

  it("keeps the union budget at its limit and relaxes only overflow schemas", () => {
    const plan = planStrictToolSchemas([
      tool(nullableProperties(MAX_STRICT_SCHEMA_UNIONS)),
      tool(nullableProperties(1)),
      tool({ type: "object", properties: {} }),
      tool(nullableProperties(30), false),
    ]);

    expect(plan.strict).toEqual([true, false, true, false]);
    expect(plan.compiledTools).toBe(2);
    expect(plan.unionParameters).toBe(MAX_STRICT_SCHEMA_UNIONS);
  });
});
