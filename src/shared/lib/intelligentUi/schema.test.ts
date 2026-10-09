import { describe, expect, it } from "vitest";
import {
  collectBindings,
  collectExpressionErrors,
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
  it("treats embedded HTML templates as page content instead of UI expressions", () => {
    const doc = okDocument({ children: [{ type: "html", markup: "<p>{{ pageHelper(pageValue) }}</p>" }] });
    expect(collectExpressionErrors(doc)).toEqual([]);
    expect(collectUnresolvedReferences(doc)).toEqual([]);
  });
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

  it("accepts icon, link, html and form components with their aliases", () => {
    const doc = okDocument({
      children: [
        { type: "icon", icon: "ChefHat", label: "Chef" },
        { type: "cite", title: "Source", url: "https://example.com", kind: "chip" },
        { type: "app", html: "<!doctype html><p>hi</p>", height: 200 },
        { type: "form", submit: "Go", required: ["city"], children: [{ type: "input", bind: "city" }] },
        { type: "button", label: "Copy", icon: "copy", action: { copy: "x" } },
      ],
    });
    expect(doc.children.map((node) => node.type)).toEqual(["icon", "link", "html", "form", "button"]);
    expect(doc.children[0]).toMatchObject({ props: { name: "ChefHat" } });
    expect(doc.children[1]).toMatchObject({ props: { text: "Source", href: "https://example.com", kind: "chip" } });
    expect(doc.children[2]).toMatchObject({ props: { markup: "<!doctype html><p>hi</p>", height: 200 } });
    const form = doc.children[3];
    if (form.type !== "error") expect(form.children).toHaveLength(1);
  });

  it("accepts a single chart series written as a string", () => {
    const doc = okDocument({
      children: [{ type: "chart", kind: "pie", data: [{ name: "a", value: 1 }], x: "name", series: "value" }],
    });
    expect(doc.children[0]).toMatchObject({ type: "chart", props: { series: ["value"] } });
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

  it("accepts each, badge, code, caption and date inputs", () => {
    const doc = okDocument({
      state: { rows: [{ name: "a" }], when: "2026-10-09" },
      children: [
        { type: "repeat", items: "{{ rows }}", as: "row", children: [{ type: "tag", label: "{{ row.name }}" }] },
        { type: "caption", text: "Illustrative values" },
        { type: "snippet", code: "x = {{ len(rows) }}", language: "python" },
        { type: "date", bind: "when", label: "When" },
        { type: "chart", kind: "bar", data: "{{ rows }}", caption: "Source: the table above" },
      ],
    });
    expect(doc.children[0]).toMatchObject({ type: "each", props: { items: "{{ rows }}", as: "row" } });
    if (doc.children[0].type === "each") {
      expect(doc.children[0].children[0]).toMatchObject({ type: "badge", props: { text: "{{ row.name }}" } });
    }
    expect(doc.children[1]).toMatchObject({ type: "text", props: { tone: "muted", size: "sm" } });
    expect(doc.children[2]).toMatchObject({ type: "code", props: { text: "x = {{ len(rows) }}", language: "python" } });
    expect(doc.children[3]).toMatchObject({ type: "input", bind: "when", props: { kind: "date" } });
    expect(doc.children[4]).toMatchObject({ type: "chart", props: { caption: "Source: the table above" } });
    expect(collectUnresolvedReferences(doc)).toEqual([]);
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

describe("collectExpressionErrors", () => {
  it("lists computed values and props that cannot run", () => {
    const doc = normalizeDocument({
      state: { rows: [], a: 1 },
      computed: { total: "sum(pluck(rows, 'v'))", bad: "a +", worse: "a.toFixed(2)" },
      children: [
        { type: "text", text: "{{ format(a, 'currency') }}" },
        { type: "metric", label: "x", value: "{{ nope(a) }}" },
        { type: "button", label: "Go", action: { send: "{{ a +" }, disabled: "a >" },
      ],
    });
    expect(collectExpressionErrors(doc)).toEqual([
      'computed "bad": Unexpected end of expression',
      'computed "worse": Unexpected token "("',
      '{{ nope(a) }}: Unknown function "nope"',
      "a >: Unexpected end of expression",
    ]);
    expect(collectExpressionErrors(normalizeDocument({ children: [{ type: "text", text: "{{ a }}" }] }))).toEqual([]);
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
