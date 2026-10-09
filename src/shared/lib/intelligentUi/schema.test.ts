import { describe, expect, it } from "vitest";
import {
  collectBindings,
  collectUnresolvedReferences,
  normalizeDocument,
  normalizeNode,
  parseUiDocument,
  resolveComponentType,
} from "./schema";

const okDocument = (source: unknown) => {
  const result = parseUiDocument(JSON.stringify(source));
  if (result.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.document;
};

describe("parseUiDocument", () => {
  it("parses state, computed and children", () => {
    const doc = okDocument({
      title: "Loan",
      state: { principal: 1000, rate: 5 },
      computed: { interest: "{{ principal * rate / 100 }}" },
      children: [
        { type: "slider", bind: "principal", props: { label: "Principal", min: 0, max: 5000 } },
        { type: "metric", label: "Interest", value: "{{ interest }}", format: "currency" },
      ],
    });
    expect(doc.title).toBe("Loan");
    expect(doc.state).toEqual({ principal: 1000, rate: 5 });
    expect(doc.computed).toEqual([{ key: "interest", expression: "{{ principal * rate / 100 }}" }]);
    expect(doc.children).toHaveLength(2);
    const slider = doc.children[0];
    expect(slider.type).toBe("slider");
    if (slider.type !== "error") {
      expect(slider.bind).toBe("principal");
      expect(slider.props).toEqual({ label: "Principal", min: 0, max: 5000 });
    }
    const metric = doc.children[1];
    if (metric.type !== "error") expect(metric.props.value).toBe("{{ interest }}");
  });

  it("accepts a bare component or array as the document", () => {
    expect(okDocument({ type: "text", text: "hi" }).children).toHaveLength(1);
    expect(okDocument([{ type: "text", text: "a" }, "b"]).children).toHaveLength(2);
    expect(okDocument([{ type: "text", text: "a" }, "b"]).children[1]).toMatchObject({
      type: "text",
      props: { text: "b" },
    });
  });

  it("accepts near-JSON with concatenated strings and a multi-select alias", () => {
    const result = parseUiDocument(`{
      state: { dietary: [] },
      computed: { summary: "{{ len(dietary) }} picked · " + "{{ join(dietary, ', ') }}" },
      children: [
        { type: "multi_select", bind: "dietary", props: { label: "Diet", options: ["vegan", "halal"] } },
      ],
    }`);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.document.computed[0].expression).toBe("{{ len(dietary) }} picked · {{ join(dietary, ', ') }}");
    expect(result.document.children[0]).toMatchObject({ type: "multiselect", bind: "dietary" });
  });

  it("renders the complete prefix of a streaming document", () => {
    const result = parseUiDocument(
      '{"state": {"n": 1}, "children": [{"type": "metric", "label": "N", "value": "{{ n }}"}, {"type": "sli',
      { streaming: true },
    );
    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.document.state).toEqual({ n: 1 });
    expect(result.document.children).toHaveLength(1);
  });

  it("accepts stepper, keyvalue and checklist", () => {
    const doc = okDocument({
      children: [
        { type: "counter", bind: "guests", min: 1 },
        { type: "summary", items: [{ label: "Style", value: "Cozy" }] },
        { type: "tasks", bind: "done", items: ["Prep", { label: "Roast", time: "13:30" }] },
      ],
    });
    expect(doc.children.map((node) => node.type)).toEqual(["stepper", "keyvalue", "checklist"]);
  });

  it("reports incomplete JSON while streaming and an error otherwise", () => {
    expect(parseUiDocument('{"children": [', { streaming: true })).toEqual({ status: "incomplete" });
    expect(parseUiDocument('{"children": [').status).toBe("error");
    expect(parseUiDocument("", { streaming: true })).toEqual({ status: "incomplete" });
  });

  it("rejects documents without components or with bad state keys", () => {
    expect(parseUiDocument("{}")).toMatchObject({ status: "error" });
    expect(parseUiDocument('{"state": {"bad key": 1}, "children": [{"type": "divider"}]}')).toMatchObject({
      status: "error",
      message: expect.stringContaining("bad key"),
    });
    expect(parseUiDocument('{"computed": {"x": 1}, "children": [{"type": "divider"}]}')).toMatchObject({
      status: "error",
    });
  });

  it("turns unknown components and invalid props into inline errors", () => {
    const doc = okDocument({
      children: [{ type: "hologram" }, { type: "heading" }, { type: "slider", props: { label: "x" } }],
    });
    expect(doc.children[0]).toEqual({ type: "error", message: 'Unknown component "hologram"' });
    expect(doc.children[1]).toMatchObject({ type: "error", message: expect.stringContaining("Invalid heading") });
    expect(doc.children[2]).toMatchObject({ type: "error", message: expect.stringContaining("bind") });
  });

  it("normalizes aliases, flat props and button actions", () => {
    const doc = okDocument({
      children: [
        { type: "Switch", binding: "on", label: "On" },
        { type: "btn", label: "Go", action: { send: "run {{ on }}" } },
        { type: "button", label: "Reset", action: "reset" },
        { type: "button", label: "Many", action: [{ set: { on: true } }, { type: "copy", text: "x" }] },
        { type: "number", bind: "n", label: "N" },
      ],
    });
    expect(doc.children[0]).toMatchObject({ type: "toggle", bind: "on" });
    expect(doc.children[1]).toMatchObject({ props: { action: [{ type: "send", message: "run {{ on }}" }] } });
    expect(normalizeNode({ type: "button", label: "Ctx", action: { send: "go", context: true } })).toMatchObject({
      props: { action: [{ type: "send", message: "go", context: true }] },
    });
    expect(doc.children[2]).toMatchObject({ props: { action: [{ type: "reset" }] } });
    expect(doc.children[3]).toMatchObject({
      props: {
        action: [
          { type: "set", values: { on: true } },
          { type: "copy", text: "x" },
        ],
      },
    });
    expect(doc.children[4]).toMatchObject({ type: "input", props: { kind: "number" } });
  });

  it("accepts timeline steps", () => {
    const doc = okDocument({
      children: [
        { type: "steps", items: ["Preheat", { label: "Roast", time: "12:30", description: "90 min" }], active: 1 },
      ],
    });
    expect(doc.children[0]).toMatchObject({ type: "timeline", props: { active: 1 } });
  });

  it("normalizes svg markup aliases and segmented chips", () => {
    const doc = okDocument({
      children: [
        { type: "diagram", svg: "<svg viewBox='0 0 10 10'><circle r='{{ r }}'/></svg>" },
        { type: "chips", bind: "part", options: ["a", "b"] },
      ],
    });
    expect(doc.children[0]).toMatchObject({ type: "svg", props: { markup: expect.stringContaining("<svg") } });
    expect(doc.children[1]).toMatchObject({ type: "segmented", bind: "part" });
  });

  it("keeps nested children and tab items", () => {
    const doc = okDocument({
      children: [
        {
          type: "tabs",
          items: [
            { label: "A", children: [{ type: "text", text: "a" }] },
            { label: "B", children: [{ type: "row", children: [{ type: "divider" }] }] },
          ],
        },
      ],
    });
    const tabs = doc.children[0];
    expect(tabs.type).toBe("tabs");
    if (tabs.type !== "error") {
      expect(tabs.tabs).toHaveLength(2);
      expect(tabs.tabs?.[1].children[0]).toMatchObject({ type: "row" });
      if (tabs.tabs?.[1].children[0].type === "row") expect(tabs.tabs[1].children[0].children).toHaveLength(1);
    }
  });

  it("collects bindings across the tree", () => {
    const doc = okDocument({
      children: [
        { type: "card", children: [{ type: "slider", bind: "a" }] },
        { type: "tabs", items: [{ label: "t", children: [{ type: "toggle", bind: "b" }] }] },
      ],
    });
    expect([...collectBindings(doc.children)].sort()).toEqual(["a", "b"]);
  });
});

describe("collectUnresolvedReferences", () => {
  it("lists identifiers that are neither state, computed nor bound", () => {
    const doc = normalizeDocument({
      state: { guests: 4, rows: [] },
      computed: { total: "guests * price", labels: "map(rows, 'item.name + suffix')" },
      children: [
        { type: "metric", label: "Total", value: "{{ totl }}" },
        { type: "text", text: "{{ guests }} guests, {{ format(total, 'currency') }}", visible: "showTotal" },
        { type: "slider", bind: "tip", label: "Tip", disabled: "locked" },
        { type: "button", label: "Go", action: { send: "{{ nope }}" } },
      ],
    });
    expect(collectUnresolvedReferences(doc)).toEqual(["locked", "nope", "price", "showTotal", "totl"]);
  });
});

describe("resolveComponentType", () => {
  it("matches case-insensitively and through aliases", () => {
    expect(resolveComponentType("Column")).toBe("column");
    expect(resolveComponentType("v-stack")).toBe("column");
    expect(resolveComponentType("KPI")).toBe("metric");
    expect(resolveComponentType("map")).toBeUndefined();
  });
});

describe("normalizeNode", () => {
  it("caps the number of components", () => {
    const wide = { type: "column", children: Array.from({ length: 2_100 }, () => ({ type: "divider" })) };
    const node = normalizeNode(wide);
    if (node.type === "error") throw new Error("root should parse");
    expect(node.children.some((child) => child.type === "error")).toBe(true);
  });
});
