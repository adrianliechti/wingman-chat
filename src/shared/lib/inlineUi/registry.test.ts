import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
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
import { REFERENCE_GROUPS, componentReference, updateComponentReference, publishedCatalog } from "./registry";
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
  for (const group of Object.values(REFERENCE_GROUPS)) {
    const path = `skills/studio/inline-ui/${group.path}`;
    const source = readFileSync(path, "utf8");
    const reference = updateComponentReference(source, group);
    expect((await format(path, reference, { printWidth: 120 })).code).toBe(source);
  }
});

it("gives every registered component and function exactly one focused lookup", () => {
  const groups = Object.values(REFERENCE_GROUPS);
  const skill = readFileSync("skills/studio/inline-ui/SKILL.md", "utf8");
  for (const group of groups) expect(skill).toContain(`](${group.path})`);
  for (const [key, catalog] of [
    ["basic", basicCatalog],
    ["wingman", wingmanCatalog],
  ] as const) {
    for (const kind of ["components", "functions"] as const) {
      const documented = groups.flatMap((group) => group[key]?.[kind] ?? []);
      expect(documented.sort()).toEqual([...catalog[kind].keys()].sort());
    }
  }
});

it("only factors out properties whose schemas and optionality are shared", () => {
  for (const [catalog, shared] of [
    [basicCatalog, ["weight"]],
    [wingmanCatalog, ["visible", "disabled", "weight"]],
  ] as const) {
    const { components } = catalog.validationSchema as {
      components: Record<string, { properties: Record<string, unknown>; required?: string[] }>;
    };
    const first = Object.values(components)[0];
    for (const schema of Object.values(components)) {
      for (const prop of shared) {
        expect(schema.properties[prop]).toBeDefined();
        expect(schema.properties[prop]).toEqual(first.properties[prop]);
        expect(schema.required?.includes(prop) ?? false).toBe(false);
      }
    }
  }
});

it("keeps unions inside collection types unambiguous in generated signatures", () => {
  expect(componentReference(REFERENCE_GROUPS.data)).toContain(
    "series?: (string|{ key: string, label?: DynamicString })[]",
  );
  expect(componentReference(REFERENCE_GROUPS.data)).toContain("active?: string|number|DataBinding|FunctionCall");
});

it("documents validator arguments when the schema requires either bound", () => {
  const reference = componentReference(REFERENCE_GROUPS.controls);
  expect(reference).toContain("length { value: DynamicString, min?: integer, max?: integer } (requires min or max)");
  expect(reference).toContain("numeric { value: DynamicNumber, min?: number, max?: number } (requires min or max)");
  expect(reference).not.toContain("DynamicString & JSON");
});

it("keeps every skill reference link readable after splitting the catalog", () => {
  const base = resolve("skills/studio/inline-ui");
  const pending = [resolve(base, "SKILL.md")];
  const visited = new Set<string>();
  while (pending.length) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(match[1])) continue;
      const target = resolve(dirname(path), match[1].split("#")[0]);
      expect(target.startsWith(base + "/")).toBe(true);
      expect(readFileSync(target).length).toBeGreaterThan(0);
      if (target.endsWith(".md")) pending.push(target);
    }
  }
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
