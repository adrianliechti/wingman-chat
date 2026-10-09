// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UiRenderer } from "./UiRenderer";

vi.mock("@/shared/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/shared/lib/confirm", () => ({ confirm: vi.fn(async () => true) }));
vi.mock("@/shell/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light", isDark: false, setTheme: () => {} }) }));

const calculator = JSON.stringify({
  title: "Tip calculator",
  state: { bill: 99, tip: 10, round: false },
  computed: { total: "round ? ceil(bill * (1 + tip / 100)) : bill * (1 + tip / 100)" },
  children: [
    { type: "slider", bind: "tip", label: "Tip", min: 0, max: 30, unit: "%" },
    { type: "toggle", bind: "round", label: "Round up" },
    { type: "metric", label: "Total", value: "{{ total }}", format: "currency", currency: "USD", digits: 2 },
    { type: "callout", tone: "warning", text: "Big tip", visible: "tip >= 25" },
    { type: "hologram" },
    { type: "button", label: "Ask", action: { send: "Split {{ total }} between 2 people" } },
  ],
});

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render(source: string, props: Partial<Parameters<typeof UiRenderer>[0]> = {}) {
  await act(async () => {
    root!.render(<UiRenderer source={source} {...props} />);
  });
}

/** Set a controlled input's value through the native setter so React sees the change. */
function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonNamed(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  return button;
}

function metricValue(): string {
  return container.querySelector(".text-2xl")?.textContent ?? "";
}

it("renders controls, recomputes derived values, and sends templated messages", async () => {
  const onSendMessage = vi.fn();
  await render(calculator, { onSendMessage });

  expect(container.textContent).toContain("Tip calculator");
  expect(metricValue()).toMatch(/108\.90/);
  expect(container.textContent).not.toContain("Big tip");
  expect(container.textContent).toContain('Unknown component "hologram"');

  const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
  await act(async () => {
    setInputValue(slider, "25");
  });
  expect(metricValue()).toMatch(/123\.75/);
  expect(container.textContent).toContain("Big tip");

  const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => {
    toggle.click();
  });
  expect(metricValue()).toMatch(/124\.00/);
  await act(async () => {
    setInputValue(slider, "7");
  });
  expect(metricValue()).toMatch(/106\.00/);

  await act(async () => {
    buttonNamed("Ask").click();
  });
  expect(onSendMessage).toHaveBeenCalledWith("Split 106 between 2 people");
});

it("renders a near-JSON document with a multi-select and templated computed values", async () => {
  const onSendMessage = vi.fn();
  const source = `{
    "title": "Dinner Setup",
    "state": { "guests": 6, "dietary": [], "style": "cozy" },
    "computed": {
      "summary": "{{ guests }} guests · " + "{{ len(dietary) > 0 ? join(dietary, ', ') : 'no restrictions noted' }}"
    },
    "children": [
      { "type": "multi_select", "bind": "dietary", "props": { "label": "Diet", "options": [
        { "value": "vegan", "label": "Vegan" }, { "value": "halal", "label": "Halal" }
      ] } },
      { "type": "callout", "props": { "tone": "info", "text": "{{ summary }}" } },
      { "type": "button", "props": { "label": "Go", "action": { "send": "Diet: {{ join(dietary, ', ') }}" } } }
    ]
  }`;
  await render(source, { onSendMessage });
  expect(container.textContent).toContain("6 guests · no restrictions noted");
  const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(boxes).toHaveLength(2);
  await act(async () => {
    boxes[1].click();
  });
  await act(async () => {
    boxes[0].click();
  });
  expect(container.textContent).toContain("6 guests · halal, vegan");
  await act(async () => {
    buttonNamed("Go").click();
  });
  expect(onSendMessage).toHaveBeenCalledWith("Diet: halal, vegan");
});

it("renders a drawing whose attributes follow state and a segmented control", async () => {
  const source = JSON.stringify({
    state: { explode: 0, part: "all" },
    computed: { d: "explode * 50", frameOn: "part == 'all' || part == 'frame' ? 1 : 0.2" },
    children: [
      {
        type: "svg",
        label: "Bike",
        markup:
          "<svg viewBox='0 0 100 50' stroke-width='3'><g id='frame' opacity='{{ frameOn }}' transform='translate({{ d }} 0)'><rect width='10' height='10'/></g><script>alert(1)</script><a href='https://x'>x</a></svg>",
      },
      { type: "slider", bind: "explode", label: "Explode", min: 0, max: 1, step: 0.5 },
      { type: "segmented", bind: "part", options: ["all", "frame", "wheels"] },
    ],
  });
  await render(source);
  const group = () => container.querySelector("#frame")!;
  expect(container.querySelector('[role="img"] svg')?.getAttribute("stroke-width")).toBe("3");
  expect(container.querySelector("script")).toBeNull();
  expect(group().getAttribute("transform")).toBe("translate(0 0)");
  expect(group().getAttribute("opacity")).toBe("1");

  await act(async () => {
    setInputValue(container.querySelector<HTMLInputElement>('input[type="range"]')!, "1");
  });
  expect(group().getAttribute("transform")).toBe("translate(50 0)");

  await act(async () => {
    buttonNamed("wheels").click();
  });
  expect(group().getAttribute("opacity")).toBe("0.2");
  expect(buttonNamed("wheels").getAttribute("aria-checked")).toBe("true");
});

it("renders a streaming prefix progressively without validation noise", async () => {
  const prefix =
    '{"state": {"guests": 4}, "children": [{"type": "metric", "label": "Guests", "value": "{{ guests }}"}, {"type": "hologram"}, {"type": "stepper", "bind": "gue';
  await render(prefix, { isStreaming: true });
  expect(metricValue()).toBe("4");
  expect(container.textContent).not.toContain("Unknown component");
  expect(container.textContent).not.toContain("Building interface");

  await render(`${prefix}sts", "label": "Guests", "min": 1}]}`, { isStreaming: false });
  expect(container.textContent).toContain('Unknown component "hologram"');
  await act(async () => {
    buttonNamed("+").click();
  });
  expect(metricValue()).toBe("5");
});

it("tracks a checklist and renders key-value summaries", async () => {
  await render(
    JSON.stringify({
      state: { done: [] },
      computed: { left: "2 - len(done)" },
      children: [
        { type: "keyvalue", items: [{ label: "Style", value: "Cozy" }] },
        { type: "checklist", bind: "done", label: "Today", items: ["Prep", { label: "Roast", time: "13:30" }] },
        { type: "metric", label: "Left", value: "{{ left }}" },
      ],
    }),
  );
  expect(container.querySelector("dt")?.textContent).toBe("Style");
  expect(container.textContent).toContain("0 of 2");
  await act(async () => {
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  });
  expect(container.textContent).toContain("1 of 2");
  expect(metricValue()).toBe("1");
});

it("shows a placeholder while streaming and the JSON when a document is invalid", async () => {
  await render('{"children": [', { isStreaming: true });
  expect(container.textContent).toContain("Building interface");

  await render('{"children": [');
  expect(container.textContent).toContain("could not be rendered");
  expect(container.querySelector("pre, code")).not.toBeNull();

  await render('{"state": {"x": 1}}');
  expect(container.textContent).toContain("at least one component");
});

it("keeps state when the same document is rendered again", async () => {
  const source = JSON.stringify({
    state: { n: 1 },
    children: [
      { type: "metric", label: "N", value: "{{ n }}" },
      { type: "button", label: "Inc", action: { set: { n: "{{ n + 1 }}" } } },
    ],
  });
  await render(source);
  await act(async () => {
    buttonNamed("Inc").click();
  });
  expect(metricValue()).toBe("2");
  await act(async () => {
    root!.unmount();
  });
  root = createRoot(container);
  await render(source);
  expect(metricValue()).toBe("2");
});
