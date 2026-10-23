import { describe, expect, it, vi } from "vitest";
import { DataContext } from "@a2ui/web_core/v1_0";
import { catalogs, WINGMAN_COMPONENTS, WINGMAN_FUNCTIONS, WINGMAN_CATALOG_ID } from "./catalog";
import { InlineUiRuntime } from "./runtime";
import fixtures from "./fixtures/components.json";
import dashboard from "../../../../skills/studio/inline-ui/references/examples/dashboard.json";
import planner from "../../../../skills/studio/inline-ui/references/examples/planner.json";

for (const catalog of catalogs) {
  describe(catalog.id, () => {
    for (const [name, definition] of catalog.components) {
      it(`${name} rejects unknown props and missing required props`, () => {
        const wire = fixtures[name as keyof typeof fixtures].createSurface.components[0];
        const props = Object.fromEntries(
          Object.entries(wire).filter(([key]) => !["id", "component", "catalogId"].includes(key)),
        );
        expect(definition.schema.safeParse(props).success).toBe(true);
        expect(definition.schema.safeParse({ ...props, unknownProperty: true }).success).toBe(false);
        const schema = (catalog.validationSchema.components as Record<string, { required?: string[] }>)[name];
        for (const key of schema.required ?? []) {
          if (["id", "component"].includes(key)) continue;
          const missing = { ...props };
          delete missing[key];
          expect(definition.schema.safeParse(missing).success, `${name}.${key} must be required`).toBe(false);
        }
      });
    }
  });
}

it.each(["Chart", "Table", "Timeline", "KeyValue", "TextList"])(
  "rejects invalid %s literal data but accepts bindings",
  (name) => {
    const definition = WINGMAN_COMPONENTS.find((entry) => entry.name === name)!;
    const wire = fixtures[name as keyof typeof fixtures].createSurface.components[0];
    const props = Object.fromEntries(
      Object.entries(wire).filter(([key]) => !["id", "component", "catalogId"].includes(key)),
    );
    const key = name === "Chart" ? "data" : name === "Table" ? "rows" : "items";
    for (const value of [42, "invalid", true, null, [{ unknown: true }]]) {
      if ((name === "Chart" || name === "Table") && Array.isArray(value)) continue; // Data columns are application-defined.
      expect(definition.schema.safeParse({ ...props, [key]: value }).success).toBe(false);
    }
    expect(definition.schema.safeParse({ ...props, [key]: { "@path": "/data" } }).success).toBe(true);
  },
);

it.each([
  ["dashboard", dashboard],
  ["planner", planner],
] as const)("resolves the complete %s authoring example", (_name, message) => {
  const runtime = new InlineUiRuntime();
  try {
    runtime.sync([{ key: "example", source: JSON.stringify(message) }]);
    expect([...runtime.errors]).toEqual([]);
  } finally {
    runtime.dispose();
  }
});

it("combines standard structured validation results with and/or/not", () => {
  const runtime = new InlineUiRuntime();
  runtime.sync([{ key: "text", source: JSON.stringify(fixtures.Text) }]);
  const context = new DataContext(runtime.getSurface("fixture-Text")!, "/");
  const required = (value: unknown) => ({ "@call": "required", args: { value } });
  try {
    expect(context.resolveDynamicValue({ "@call": "and", args: { values: [required("yes"), required("")] } })).toBe(
      false,
    );
    expect(context.resolveDynamicValue({ "@call": "or", args: { values: [required("yes"), required("")] } })).toBe(
      true,
    );
    expect(context.resolveDynamicValue({ "@call": "not", args: { value: required("") } })).toBe(true);
  } finally {
    runtime.dispose();
  }
});

it("validates and executes each Wingman function only through explicit arguments", async () => {
  const runtime = new InlineUiRuntime();
  runtime.sync([{ key: "text", source: JSON.stringify(fixtures.Text) }]);
  const context = new DataContext(runtime.getSurface("fixture-Text")!, "/");
  const calls: Record<string, Record<string, unknown>> = {
    evaluate: { expression: "n * 2", values: { n: 3 } },
    setValue: { path: "/n", value: 7 },
    copyText: { text: "Example" },
  };
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  try {
    for (const fn of WINGMAN_FUNCTIONS) {
      expect(fn.schema.safeParse(calls[fn.name]).success).toBe(true);
      expect(fn.schema.safeParse({ ...calls[fn.name], extra: true }).success).toBe(false);
      await fn.execute(calls[fn.name], context);
    }
    expect(runtime.getSurface("fixture-Text")!.dataModel.get("/n")).toBe(7);
    expect(writeText).toHaveBeenCalledWith("Example");
    expect(WINGMAN_CATALOG_ID).toBe("urn:wingman:inline-ui:catalog:1");
  } finally {
    runtime.dispose();
    vi.unstubAllGlobals();
  }
});
