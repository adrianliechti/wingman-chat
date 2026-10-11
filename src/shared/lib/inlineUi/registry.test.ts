import { readFileSync, readdirSync } from "node:fs";
import { format } from "vite-plus/fmt";
import { describe, expect, it } from "vitest";
import {
  getValue,
  RendererCapabilitiesSchema,
  RendererToAgentMessageSchema,
  DataContext,
  ResolvedBinding,
} from "@a2ui/web_core/v1_0";
import { A2UI_VERSION, catalogs, basicCatalog, wingmanCatalog, WINGMAN_COMPONENTS, WINGMAN_FUNCTIONS } from "./catalog";
import { componentReference, updateComponentReference, publishedCatalog } from "./registry";
import { InlineUiRuntime } from "./runtime";
import fixtures from "./fixtures/components.json";

it("covers every registered component with an explicit wire fixture", () => {
  expect(Object.keys(fixtures).sort()).toEqual(catalogs.flatMap((catalog) => [...catalog.components.keys()]).sort());
  expect(WINGMAN_COMPONENTS).toHaveLength(24);
});

it("locks the published catalog schemas and generated references to registered definitions", async () => {
  for (const [name, catalog] of [
    ["basic-catalog", basicCatalog],
    ["wingman-catalog", wingmanCatalog],
  ] as const) {
    const disk = JSON.parse(readFileSync(`skills/studio/inline-ui/references/${name}.json`, "utf8"));
    expect(disk).toEqual(publishedCatalog(catalog));
    expect(disk).toMatchSnapshot();
  }
  for (const path of ["src/features/chat/prompts/inline-ui.txt", "skills/studio/inline-ui/references/components.md"]) {
    const source = readFileSync(path, "utf8");
    const reference = updateComponentReference(source);
    expect(path.endsWith(".md") ? (await format(path, reference, { printWidth: 120 })).code : reference).toBe(source);
  }
  expect(componentReference()).toContain("ChoicePicker");
  expect(componentReference()).toContain("evaluate");
});

it("advertises only our pinned protocol version and registered catalogs", () => {
  const runtime = new InlineUiRuntime();
  const capabilities = runtime.processor.getRendererCapabilities({ versions: [A2UI_VERSION] });
  expect(RendererCapabilitiesSchema.safeParse(capabilities).success).toBe(true);
  expect(capabilities).toMatchSnapshot();
  runtime.dispose();
});

describe("published SDK reference fixtures", () => {
  const directory = new URL("./schemas/catalogs/basic/examples/", import.meta.resolve("@a2ui/web_core/v1_0"));
  const files = readdirSync(directory).filter((file) => file.endsWith(".json"));
  it.each(files)("processes %s without adapting upstream messages", (file) => {
    const fixture = JSON.parse(readFileSync(new URL(file, directory), "utf8")) as { messages: unknown[] };
    const runtime = new InlineUiRuntime();
    try {
      runtime.sync([{ key: file, source: JSON.stringify(fixture.messages) }]);
      if (file === "31_incremental-dashboard.json") {
        // This published fixture uses "left-panel", disallowed by the pinned
        // v1.0 identifier schema. Assert the rejection so upgrades are reviewed.
        expect([...runtime.errors.values()].join()).toContain("must be a valid UAX #31 identifier");
        return;
      }
      expect([...runtime.errors]).toEqual([]);
      expect(
        [...runtime.resolvers.values()].map((resolver) => getValue(resolver.rootNode)?.toJSON()),
      ).toMatchSnapshot();
    } finally {
      runtime.dispose();
    }
  });
});

it("validates all renderer message types against upstream schemas", () => {
  const messages = [
    {
      version: "v1.0",
      action: {
        name: "save",
        surfaceId: "main",
        sourceComponentId: "button",
        timestamp: "2026-10-11T12:00:00Z",
        context: {},
      },
    },
    {
      version: "v1.0",
      callAgentFunction: {
        surfaceId: "main",
        functionCallId: "f",
        callFunction: { "@call": "search", args: { query: "test" } },
      },
    },
    { version: "v1.0", rendererFunctionResponse: { functionCallId: "f", value: 1 } },
    {
      version: "v1.0",
      error: { code: "VALIDATION_FAILED", surfaceId: "main", path: "/value", message: "Invalid value" },
    },
  ];
  for (const message of messages) expect(RendererToAgentMessageSchema.safeParse(message).success).toBe(true);
});

it("uses standard required semantics, including false and whitespace", () => {
  const runtime = new InlineUiRuntime();
  runtime.sync([{ key: "test", source: JSON.stringify(fixtures.Text) }]);
  const context = new DataContext(runtime.getSurface("fixture-Text")!, "/");
  for (const [value, valid] of [
    [false, true],
    ["   ", true],
    ["", false],
    [[], false],
    [null, false],
    [0, true],
  ] as const) {
    expect(context.resolveDynamicValue<{ valid: boolean }>({ "@call": "required", args: { value } }).valid).toBe(valid);
  }
  runtime.dispose();
});

it("defines every Wingman function with a strict, versioned input contract", () => {
  expect(WINGMAN_FUNCTIONS.map((fn) => fn.name)).toEqual(["evaluate", "setValue", "copyText"]);
  for (const fn of WINGMAN_FUNCTIONS) expect(fn.schema.safeParse({ unknownArgument: true }).success).toBe(false);
  const runtime = new InlineUiRuntime();
  runtime.sync([{ key: "test", source: JSON.stringify(fixtures.Stepper) }]);
  const node = getValue(runtime.resolvers.get("fixture-Stepper")!.rootNode)!;
  expect(getValue(node.props).value).toBeInstanceOf(ResolvedBinding);
  runtime.dispose();
});
