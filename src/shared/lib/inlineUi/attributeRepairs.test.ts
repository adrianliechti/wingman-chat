// @vitest-environment happy-dom
import { A2uiValidationError } from "@a2ui/web_core/v1_0";
import { expect, it } from "vitest";
import { attributeRepairHints } from "./attributeRepairs";
import { BASIC_CATALOG_ID, WINGMAN_CATALOG_ID } from "./catalog";
import { InlineUiRuntime } from "./runtime";
import fixtures from "./fixtures/components.json";

it.each(["Heading", "Svg", "Grid", "Form"] as const)(
  "explains a missing catalogId on %s without rewriting the UI",
  (name) => {
    const message = structuredClone(fixtures[name]);
    delete message.createSurface.components[0].catalogId;
    const original = structuredClone(message);
    const runtime = new InlineUiRuntime();
    try {
      runtime.sync([{ key: "missing-catalog", source: JSON.stringify(message) }]);
      expect(runtime.errors.get("missing-catalog")).toContain(
        `Catalog repair: ${name} requires catalogId "${WINGMAN_CATALOG_ID}"`,
      );
      expect(message).toEqual(original);
      message.createSurface.components[0].catalogId = WINGMAN_CATALOG_ID;
      runtime.sync([{ key: "missing-catalog", source: JSON.stringify(message) }]);
      expect(runtime.errors.size).toBe(0);
    } finally {
      runtime.dispose();
    }
  },
);

it("directs Basic components back to their catalog and does not invent unknown components", () => {
  expect(
    attributeRepairHints(
      new A2uiValidationError(`Unknown component type 'Text' not found in catalog '${WINGMAN_CATALOG_ID}'.`),
    ),
  ).toEqual([expect.stringContaining(`Text requires catalogId "${BASIC_CATALOG_ID}"`)]);
  expect(
    attributeRepairHints(
      new A2uiValidationError(`Unknown component type 'InventedHeading' not found in catalog '${BASIC_CATALOG_ID}'.`),
    ),
  ).toEqual([]);
  expect(
    attributeRepairHints(new Error(`Unknown component type 'Heading' not found in catalog '${BASIC_CATALOG_ID}'.`)),
  ).toEqual([]);
});

it.each([
  ["Row", "gap", "md", "Grid", "references/layout.md"],
  ["Text", "tone", "info", "Callout", "Badge"],
  ["Image", "height", 120, "Svg", "Chart"],
  ["Tabs", "defaultOpen", true, "Collapsible", WINGMAN_CATALOG_ID],
  ["Slider", "step", 0.5, "integer number of intervals", "Stepper.step"],
  ["TextField", "disabled", true, "matching Wingman control", "does not disable its Basic descendants"],
  ["TextField", "description", "Helper", "separate Text", "references/controls.md"],
  ["Button", "label", "Continue", "child pointing to a Text", "references/controls.md"],
  ["Text", "style", { color: "red" }, "unsupported by every registered component", "Remove it"],
  ["Grid", "description", "Helper", "Metric", "Collapsible"],
] as const)("explains the correction for %s.%s using real SDK errors", (name, property, value, first, second) => {
  const message = structuredClone(fixtures[name]);
  Object.assign(message.createSurface.components[0], { [property]: value });
  const runtime = new InlineUiRuntime();
  try {
    runtime.sync([{ key: "invalid", source: JSON.stringify(message) }]);
    const error = runtime.errors.get("invalid")!;
    expect(error).toContain(`Unrecognized key(s) in object: '${property}'`);
    expect(error).toContain(first);
    expect(error).toContain(second);
  } finally {
    runtime.dispose();
  }
});

it("does not treat nested column attributes as top-level component properties", () => {
  const message = structuredClone(fixtures.Table);
  Object.assign(message.createSurface.components[0].columns![0], { gap: "md" });
  const runtime = new InlineUiRuntime();
  try {
    runtime.sync([{ key: "nested", source: JSON.stringify(message) }]);
    const error = runtime.errors.get("nested")!;
    expect(error).toContain("Unrecognized key(s) in object: 'gap'");
    expect(error).not.toContain("Attribute repair");
    expect(error).not.toContain("Grid");
  } finally {
    runtime.dispose();
  }
});

it("does not infer unsupported attributes from arbitrary error text", () => {
  const text = "Validation failed for component 'Text' (root): root: Unrecognized key(s) in object: 'visible'";
  expect(attributeRepairHints(new Error(text))).toEqual([]);
  expect(attributeRepairHints(new A2uiValidationError(text))).toEqual([]);
});
