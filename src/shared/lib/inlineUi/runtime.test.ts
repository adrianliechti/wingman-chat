// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getValue, ResolvedBinding, WritableBinding, type ComponentNode } from "@a2ui/web_core/v1_0";
import { InlineUiRuntime } from "./runtime";
import { BASIC_CATALOG_ID, WINGMAN_CATALOG_ID } from "./catalog";
import { parseMessages } from "./protocol";
import fixtures from "./fixtures/components.json";

const runtimes: InlineUiRuntime[] = [];
const runtime = (owner?: string) => {
  const value = new InlineUiRuntime(owner);
  runtimes.push(value);
  return value;
};
const block = (message: unknown, key = "one") => ({ key, source: JSON.stringify(message) });
const create = (components: unknown[], dataModel: Record<string, unknown> = {}) => ({
  version: "v1.0",
  createSurface: { surfaceId: "main", catalogId: BASIC_CATALOG_ID, sendDataModel: true, components, dataModel },
});
afterEach(() => {
  for (const value of runtimes.splice(0)) value.dispose();
  localStorage.clear();
});

describe("pinned A2UI catalog contract", () => {
  it.each(Object.entries(fixtures))("processes and resolves %s", (_name, fixture) => {
    const ui = runtime();
    ui.sync([block(fixture)]);
    expect([...ui.errors]).toEqual([]);
    const root = getValue(ui.resolvers.get(fixture.createSurface.surfaceId)!.rootNode)!;
    expect(root.state).toBe("resolved");
    expect(root.type).toBe(fixture.createSurface.components[0].component);
    expect(root.toJSON()).toMatchSnapshot();
  });
});

it("edits each row through relative bindings and preserves unaffected rows", () => {
  const ui = runtime();
  ui.sync([
    block(
      create(
        [
          { id: "root", component: "List", children: { path: "/people", componentId: "person" } },
          { id: "person", component: "TextField", label: "Name", value: { "@path": "name" } },
        ],
        { people: [{ name: "Ada" }, { name: "Grace" }] },
      ),
    ),
  ]);
  expect([...ui.errors]).toEqual([]);
  const root = getValue(ui.resolvers.get("main")!.rootNode)!;
  const nodes = getValue(root.props).children as ComponentNode[];
  (getValue(nodes[1].props).value as WritableBinding<string>).set("Katherine");
  expect(ui.getSurface("main")!.dataModel.get("/people")).toEqual([{ name: "Ada" }, { name: "Katherine" }]);
});

it("recomputes a Wingman calculation when explicitly bound input changes", () => {
  const ui = runtime();
  ui.sync([
    block(
      create(
        [
          {
            id: "root",
            component: "Metric",
            catalogId: WINGMAN_CATALOG_ID,
            label: "Total",
            value: {
              "@call": "evaluate",
              catalogId: WINGMAN_CATALOG_ID,
              args: { expression: "seats * 12", values: { seats: { "@path": "/seats" } } },
            },
          },
        ],
        { seats: 2 },
      ),
    ),
  ]);
  expect([...ui.errors]).toEqual([]);
  const node = getValue(ui.resolvers.get("main")!.rootNode)!;
  expect((getValue(node.props).value as ResolvedBinding<number>).value).toBe(24);
  ui.getSurface("main")!.dataModel.set("/seats", 4);
  expect((getValue(node.props).value as ResolvedBinding<number>).value).toBe(48);
});

it("dispatches the standard action envelope with current context and opted-in data", async () => {
  const ui = runtime();
  ui.onSubmit = vi.fn();
  ui.sync([block(fixtures.Button)]);
  const surface = ui.getSurface("fixture-Button")!;
  surface.dataModel.set("/name", "Grace");
  const node = getValue(ui.resolvers.get(surface.id)!.rootNode)!;
  await (getValue(node.props).action as () => Promise<void>)();
  expect(ui.onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      message: {
        version: "v1.0",
        action: expect.objectContaining({
          name: "choose",
          surfaceId: surface.id,
          sourceComponentId: "root",
          context: { value: "Grace" },
        }),
      },
      metadata: expect.objectContaining({
        a2uiRendererDataModel: {
          version: "v1.0",
          surfaces: { [surface.id]: expect.objectContaining({ name: "Grace" }) },
        },
      }),
    }),
  );
});

it("replays saved edits before applying new agent updates and isolates conversations", () => {
  const first = block(fixtures.TextField);
  const ui = runtime("chat-a");
  ui.sync([first]);
  ui.getSurface("fixture-TextField")!.dataModel.set("/name", "Grace");
  ui.flush();
  const restored = runtime("chat-a");
  restored.sync([first]);
  expect(restored.getSurface("fixture-TextField")!.dataModel.get("/name")).toBe("Grace");
  const update = block(
    { version: "v1.0", updateDataModel: { surfaceId: "fixture-TextField", path: "/name", value: "Katherine" } },
    "two",
  );
  const appended = runtime("chat-a");
  appended.sync([first, update]);
  expect(appended.getSurface("fixture-TextField")!.dataModel.get("/name")).toBe("Katherine");
  const other = runtime("chat-b");
  other.sync([first]);
  expect(other.getSurface("fixture-TextField")!.dataModel.get("/name")).toBe("Ada");
});

it("applies appended messages once, deletes surfaces, and rebuilds edited transcripts", () => {
  const ui = runtime();
  const initial = block(fixtures.TextField);
  ui.sync([initial]);
  const surface = ui.getSurface("fixture-TextField")!;
  surface.dataModel.set("/name", "Grace");
  ui.sync([initial]);
  expect(ui.getSurface(surface.id)).toBe(surface);
  expect(surface.dataModel.get("/name")).toBe("Grace");
  ui.sync([initial, block({ version: "v1.0", deleteSurface: { surfaceId: surface.id } }, "delete")]);
  expect(ui.getSurface(surface.id)).toBeUndefined();
  ui.sync([block(fixtures.Metric)]);
  expect(ui.getSurface("fixture-Metric")).toBeDefined();
});

it("rejects unknown catalogs, unknown components, cycles and prototype paths", () => {
  const cases = [
    { version: "v1.0", createSurface: { surfaceId: "main", catalogId: "https://untrusted.test/catalog" } },
    create([{ id: "root", component: "Unknown" }]),
    create([{ id: "root", component: "Column", children: ["root"] }]),
    create([{ id: "root", component: "TextField", label: "Bad", value: { "@path": "/__proto__/polluted" } }]),
  ];
  for (const message of cases) {
    const ui = runtime();
    ui.sync([block(message)]);
    expect(ui.errors.size).toBeGreaterThan(0);
  }
  expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
});

it("never executes renderer RPCs from a persisted transcript", () => {
  const ui = runtime();
  ui.onSubmit = vi.fn();
  ui.sync([
    block({
      version: "v1.0",
      callRendererFunction: {
        functionCallId: "open",
        callFunction: { "@call": "openUrl", args: { url: "https://example.com" } },
      },
    }),
  ]);
  expect([...ui.errors.values()].join()).toContain("not supported in persisted UI fences");
  expect(ui.onSubmit).not.toHaveBeenCalled();
});

it("validates every protocol envelope using the pinned upstream schema", () => {
  for (const message of [
    fixtures.Text,
    {
      version: "v1.0",
      updateComponents: { surfaceId: "a", components: [{ id: "root", component: "Text", text: "Changed" }] },
    },
    { version: "v1.0", updateDataModel: { surfaceId: "a", path: "/value", value: 2 } },
    { version: "v1.0", deleteSurface: { surfaceId: "a" } },
    {
      version: "v1.0",
      callRendererFunction: { functionCallId: "f", callFunction: { "@call": "formatNumber", args: { value: 1 } } },
    },
    { version: "v1.0", agentFunctionResponse: { functionCallId: "f", value: 2 } },
  ])
    expect(parseMessages(JSON.stringify(message)).error).toBeUndefined();
});

it("clears rejected-message errors when a transcript is corrected", () => {
  const ui = runtime();
  ui.sync([block(create([{ id: "root", component: "Unknown" }]))]);
  expect(ui.errors.size).toBeGreaterThan(0);
  ui.sync([block(fixtures.Text)]);
  expect([...ui.errors]).toEqual([]);
});

it.each([
  "{",
  JSON.stringify({ contract: "obsolete", messages: [], models: {} }),
  JSON.stringify({
    contract: "v1.0:0.13.0:urn:wingman:inline-ui:catalog:1",
    messages: ["different transcript"],
    models: { "fixture-TextField": { name: "Stale" } },
  }),
])("ignores corrupt or incompatible persisted state", (saved) => {
  localStorage.setItem("wingman:a2ui:1:chat", saved);
  const ui = runtime("chat");
  ui.sync([block(fixtures.TextField)]);
  expect(ui.getSurface("fixture-TextField")!.dataModel.get("/name")).toBe("Ada");
});

it("omits models from actions when surfaces do not opt in", async () => {
  const fixture = structuredClone(fixtures.Button);
  fixture.createSurface.sendDataModel = false;
  const ui = runtime();
  ui.onSubmit = vi.fn();
  ui.sync([block(fixture)]);
  const node = getValue(ui.resolvers.get(fixture.createSurface.surfaceId)!.rootNode)!;
  await (getValue(node.props).action as () => Promise<void>)();
  expect(vi.mocked(ui.onSubmit).mock.calls[0][0].metadata.a2uiRendererDataModel).toBeUndefined();
});

it("retains binding diagnostics across no-op syncs and clears them after repair", () => {
  const ui = runtime();
  const initial = block(
    create([
      {
        id: "root",
        component: "Metric",
        catalogId: WINGMAN_CATALOG_ID,
        label: "Result",
        value: { "@call": "evaluate", catalogId: WINGMAN_CATALOG_ID, args: { expression: "missing(1)", values: {} } },
      },
    ]),
  );
  ui.sync([initial]);
  expect(ui.errors.get("main")).toContain("missing");
  ui.sync([initial]);
  expect(ui.errors.get("main")).toContain("missing");
  ui.sync([
    initial,
    block(
      {
        version: "v1.0",
        updateComponents: {
          surfaceId: "main",
          components: [{ id: "root", component: "Metric", catalogId: WINGMAN_CATALOG_ID, label: "Result", value: 3 }],
        },
      },
      "repair",
    ),
  ]);
  expect([...ui.errors]).toEqual([]);
});
