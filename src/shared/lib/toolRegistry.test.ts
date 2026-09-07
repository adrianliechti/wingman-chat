import { describe, expect, it } from "vitest";
import type { Tool } from "../types/chat";
import { compileToolRegistry, ToolArgumentValidationError } from "./toolRegistry";

function flagTool(): Tool {
  return {
    name: "grep",
    description: "Search text",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        "-n": { type: "boolean", default: true },
        "-i": { type: "boolean", default: false },
        "-A": { type: "integer" },
        nested: { type: "object", properties: {}, additionalProperties: false },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    function: async () => [],
  };
}

describe("tool argument recovery hints", () => {
  it.each([
    ["n", "true"],
    ["i", "false"],
  ])("suggests the declared -%s flag and its default without accepting aliases", (key, defaultValue) => {
    const tool = flagTool();
    const registry = compileToolRegistry([tool]);
    const args = Object.freeze({ pattern: "needle", [key]: true });
    expect(() => registry.parse(tool, args)).toThrow(ToolArgumentValidationError);
    expect(() => registry.parse(tool, args)).toThrow(
      `Use the declared parameter "-${key}", including the leading hyphen, or omit it to use its default (${defaultValue})`,
    );
    expect(args).toEqual({ pattern: "needle", [key]: true });
    expect(registry.parse(tool, { pattern: "needle" })).toEqual({ pattern: "needle" });
    expect(registry.parse(tool, { pattern: "needle", [`-${key}`]: true })).toEqual({
      pattern: "needle",
      [`-${key}`]: true,
    });
  });

  it("does not invent defaults or suggest top-level flags for nested arguments", () => {
    const tool = flagTool();
    const registry = compileToolRegistry([tool]);
    expect(() => registry.parse(tool, { pattern: "needle", A: 1 })).toThrow(
      'Use the declared parameter "-A", including the leading hyphen',
    );
    for (const args of [
      { pattern: "needle", unknown: true },
      { pattern: "needle", nested: { n: true } },
    ]) {
      try {
        registry.parse(tool, args);
        throw new Error("Expected validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(ToolArgumentValidationError);
        expect((error as Error).message).not.toContain("Use the declared parameter");
      }
    }
  });
});
