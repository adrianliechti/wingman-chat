import { describe, expect, it } from "vitest";
import type { ElicitationSchema, ElicitationPrimitiveSchema } from "@/shared/types/elicitation";
import { buildInitialElicitationValues, validateElicitationForm } from "./elicitationForm";

const form = (field: ElicitationPrimitiveSchema, required = true): ElicitationSchema => ({
  type: "object",
  properties: { answer: field },
  ...(required && { required: ["answer"] }),
});

describe("elicitation answers", () => {
  it("keeps missing booleans unanswered while preserving explicit false defaults", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        missing: { type: "boolean" },
        disabled: { type: "boolean", default: false },
        enabled: { type: "boolean", default: true },
        count: { type: "number", default: 0 },
        text: { type: "string", default: "Hello" },
        list: { type: "array", items: { enum: ["a"] }, default: ["a"] },
      },
    };
    const draft = buildInitialElicitationValues(schema);
    expect(draft).toEqual({
      missing: undefined,
      disabled: false,
      enabled: true,
      count: "0",
      text: "Hello",
      list: ["a"],
    });
    expect(validateElicitationForm(schema, draft)).toEqual({
      content: { disabled: false, enabled: true, count: 0, text: "Hello", list: ["a"] },
    });
    expect(validateElicitationForm(form({ type: "boolean" }), {})).toEqual({ errors: { answer: "Choose Yes or No." } });
    expect(validateElicitationForm(form({ type: "boolean" }), { answer: false })).toEqual({
      content: { answer: false },
    });
  });

  it.each([
    [{ type: "number" }, "0", 0],
    [{ type: "number", minimum: 1, maximum: 4 }, "2.5", 2.5],
    [{ type: "integer", minimum: 1 }, "3", 3],
    [{ type: "string", minLength: 2, maxLength: 6 }, " word ", "word"],
    [{ type: "string", format: "email" }, "a@example.com", "a@example.com"],
    [{ type: "string", format: "uri" }, "https://example.com", "https://example.com"],
    [{ type: "string", format: "date" }, "2026-10-11", "2026-10-11"],
    [{ type: "string", format: "date-time" }, "2026-10-11T12:00", "2026-10-11T12:00"],
    [{ type: "string", enum: ["a", "b"] }, "a", "a"],
    [{ type: "string", oneOf: [{ const: "b", title: "B" }] }, "b", "b"],
    [{ type: "array", items: { anyOf: [{ const: "a", title: "A" }] } }, ["a"], ["a"]],
    [{ type: "array", items: { type: "string" } }, ["A written answer"], ["A written answer"]],
  ])("validates and normalizes %j", (field, answer, expected) => {
    expect(validateElicitationForm(form(field as ElicitationPrimitiveSchema), { answer })).toEqual({
      content: { answer: expected },
    });
  });

  it.each([
    [{ type: "number" }, "Infinity"],
    [{ type: "number" }, "NaN"],
    [{ type: "number", minimum: 2 }, "1"],
    [{ type: "number", maximum: 2 }, "3"],
    [{ type: "integer" }, "2.5"],
    [{ type: "string", minLength: 3 }, "ab"],
    [{ type: "string", maxLength: 2 }, "abc"],
    [{ type: "string", format: "email" }, "invalid"],
    [{ type: "string", format: "uri" }, "invalid"],
    [{ type: "string", format: "date" }, "invalid"],
    [{ type: "string", enum: ["a"] }, "unexpected"],
    [{ type: "array", items: { enum: ["a"] } }, ["unexpected"]],
    [{ type: "array", items: { type: "string" } }, ["a", "a"]],
    [{ type: "array", minItems: 2, items: { type: "string" } }, ["a"]],
    [{ type: "array", maxItems: 1, items: { type: "string" } }, ["a", "b"]],
  ])("rejects invalid values for %j", (field, answer) => {
    expect(validateElicitationForm(form(field as ElicitationPrimitiveSchema), { answer }).errors?.answer).toBeTruthy();
  });

  it("omits blank optional fields, including choices with a minimum when answered", () => {
    for (const field of [
      { type: "boolean" },
      { type: "string" },
      { type: "number" },
      { type: "array", minItems: 2, items: { type: "string" } },
    ] as const) {
      const schema = form(field, false);
      expect(validateElicitationForm(schema, buildInitialElicitationValues(schema))).toEqual({ content: {} });
    }
  });

  it("handles arbitrary schema property names without inheriting object members", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: Object.fromEntries(["__proto__", "constructor"].map((name) => [name, { type: "string" }])),
    };
    const content = Object.fromEntries(["__proto__", "constructor"].map((name) => [name, "answer"]));
    expect(validateElicitationForm(schema, content)).toEqual({ content });
  });
});
