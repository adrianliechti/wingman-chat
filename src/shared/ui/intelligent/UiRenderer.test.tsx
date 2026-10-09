// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UiRenderer } from "./UiRenderer";
import { Markdown } from "@/shared/ui/Markdown";

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

it("keeps form submission disabled while streaming and submits through the form event", async () => {
  const source = JSON.stringify({
    state: { name: "Ada" },
    children: [
      {
        type: "form",
        submit: "Create",
        required: ["name"],
        message: "Create {{ name }}",
        children: [{ type: "input", bind: "name", label: "Name" }],
      },
    ],
  });
  const onSendMessage = vi.fn();
  await render(source, { isStreaming: true, onSendMessage });
  expect(buttonNamed("Create").disabled).toBe(true);
  await act(async () => {
    container.querySelector("form")!.requestSubmit();
  });
  expect(onSendMessage).not.toHaveBeenCalled();
  await render(source, { onSendMessage });
  expect(buttonNamed("Create").type).toBe("submit");
  await act(async () => {
    container.querySelector("form")!.requestSubmit();
  });
  expect(onSendMessage).toHaveBeenCalledExactlyOnceWith('Create Ada\n\nCurrent values: {"name":"Ada"}');
});

it("requires meaningful text in required form fields", async () => {
  await render(
    JSON.stringify({
      state: { name: "   " },
      children: [{ type: "form", submit: "Save", required: ["name"], children: [{ type: "input", bind: "name" }] }],
    }),
  );
  expect(buttonNamed("Save").disabled).toBe(true);
});

it("preserves SVG element case for gradients and animation", async () => {
  await render(
    JSON.stringify({
      children: [
        {
          type: "svg",
          label: "Gradient",
          markup:
            "<svg viewBox='0 0 20 20'><defs><linearGradient id='fade'><stop offset='0' stop-color='red'/><stop offset='1' stop-color='blue'/></linearGradient></defs><rect width='20' height='20' fill='url(#fade)'/></svg>",
        },
      ],
    }),
  );
  expect(container.querySelector("#fade")?.localName).toBe("linearGradient");
});

it.each(["wingman-ui", "intelligent-ui"])("renders the %s fence alias through Markdown", async (language) => {
  const source = JSON.stringify({ children: [{ type: "heading", text: "Alias rendered" }] });
  await act(async () => {
    root!.render(<Markdown>{`\`\`\`${language}\n${source}\n\`\`\``}</Markdown>);
  });
  expect(container.querySelector("h3")?.textContent).toBe("Alias rendered");
});

it("keeps radios in separate interfaces independent even when their state keys match", async () => {
  const source = (title: string) =>
    JSON.stringify({
      title,
      state: { choice: "A" },
      children: [{ type: "radio", label: title, bind: "choice", options: ["A", "B"] }],
    });
  await act(async () => {
    root!.render(
      <>
        <UiRenderer source={source("First choice")} />
        <UiRenderer source={source("Second choice")} />
      </>,
    );
  });
  const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  expect(radios[0].name).not.toBe(radios[2].name);
  await act(async () => {
    radios[3].click();
  });
  expect(radios[0].checked).toBe(true);
  expect(radios[3].checked).toBe(true);
});

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

  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
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

it("enables state controls, actions and saved state only after streaming finishes", async () => {
  const source = JSON.stringify({
    title: "Streaming preview",
    state: { guests: 4 },
    children: [
      { type: "metric", label: "Guests", value: "{{ guests }}" },
      { type: "stepper", bind: "guests", label: "Guests", min: 1 },
      { type: "button", label: "Continue", action: { send: "Plan for {{ guests }} guests" } },
    ],
  });
  const onSendMessage = vi.fn();
  const getItem = vi.fn(() => JSON.stringify({ guests: 7 }));
  vi.stubGlobal("localStorage", { getItem, setItem: vi.fn(), removeItem: vi.fn() });

  // A valid prefix and complete JSON still belong to the preview until the
  // host marks the fence finished.
  for (const preview of [source.slice(0, -2) + ",", source]) {
    await render(preview, { isStreaming: true, onSendMessage });
    expect(metricValue()).toBe("4");
    expect(buttonNamed("+").disabled).toBe(true);
    expect(buttonNamed("Continue").disabled).toBe(true);
    expect(container.querySelector('input[type="number"]')?.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      buttonNamed("+").click();
      buttonNamed("Continue").click();
    });
    expect(metricValue()).toBe("4");
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  }

  await render(source, { isStreaming: false, onSendMessage });
  expect(getItem).toHaveBeenCalled();
  expect(metricValue()).toBe("7");
  expect(buttonNamed("+").disabled).toBe(false);
  expect(buttonNamed("Continue").disabled).toBe(false);
  await act(async () => {
    buttonNamed("+").click();
  });
  expect(metricValue()).toBe("8");
  await act(async () => {
    buttonNamed("Continue").click();
  });
  expect(onSendMessage).toHaveBeenCalledExactlyOnceWith("Plan for 8 guests");
});

it("renders icons from the shared Lucide set with tolerant names", async () => {
  await render(
    JSON.stringify({
      children: [
        { type: "icon", name: "ChefHat", label: "Chef" },
        { type: "icon", name: "no-such-icon" },
        { type: "button", label: "Duplicate", icon: "copy", action: { copy: "x" } },
      ],
    }),
  );
  // The icon set loads asynchronously on first use.
  for (let i = 0; i < 20 && !container.querySelector('[data-icon="ChefHat"] path'); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  expect(container.querySelector('[data-icon="ChefHat"] path')).not.toBeNull();
  expect(container.querySelector('[role="img"][aria-label="Chef"]')).not.toBeNull();
  expect(container.querySelector('[data-icon="NoSuchIcon"] path')).not.toBeNull();
  expect(buttonNamed("Duplicate").querySelector('[data-icon="Copy"]')).not.toBeNull();
});

it("submits a form with every bound value and renders links safely", async () => {
  const onSendMessage = vi.fn();
  await render(
    JSON.stringify({
      state: { city: "", days: 2 },
      children: [
        {
          type: "form",
          submit: "Plan",
          required: ["city"],
          message: "Plan a trip.",
          children: [
            { type: "input", bind: "city", label: "City" },
            { type: "stepper", bind: "days", label: "Days", min: 1 },
          ],
        },
        { type: "link", text: "Guide", href: "https://example.com/guide" },
        { type: "link", text: "Nope", href: "javascript:alert(1)" },
      ],
    }),
    { onSendMessage },
  );
  expect(buttonNamed("Plan").disabled).toBe(true);
  await act(async () => {
    setInputValue(container.querySelector<HTMLInputElement>('input[type="text"]')!, "Lisbon");
  });
  expect(buttonNamed("Plan").disabled).toBe(false);
  await act(async () => {
    buttonNamed("Plan").click();
  });
  expect(onSendMessage).toHaveBeenCalledWith(
    `Plan a trip.\n\nCurrent values: ${JSON.stringify({ city: "Lisbon", days: 2 })}`,
  );

  const anchors = container.querySelectorAll("a");
  expect(anchors).toHaveLength(1);
  expect(anchors[0].getAttribute("rel")).toContain("noopener");
  expect(anchors[0].getAttribute("href")).toBe("https://example.com/guide");
  expect(container.textContent).toContain("Nope");
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

it("repeats children per item with item and index in scope, actions included", async () => {
  const onSendMessage = vi.fn();
  await render(
    JSON.stringify({
      state: {
        budget: 50,
        plans: [
          { name: "Starter", price: 0 },
          { name: "Pro", price: 29 },
          { name: "Max", price: 99 },
        ],
      },
      computed: { affordable: "filter(plans, 'price <= budget')" },
      children: [
        { type: "keyvalue", items: [{ label: "Budget", value: "{{ budget }} CHF" }] },
        {
          type: "each",
          items: "{{ affordable }}",
          as: "plan",
          children: [
            {
              type: "badge",
              text: "{{ index + 1 }}. {{ plan.name }}",
              tone: "{{ plan.price == 0 ? 'success' : 'info' }}",
            },
            {
              type: "button",
              label: "Pick {{ plan.name }}",
              action: { send: "I take {{ plan.name }} at {{ plan.price }}" },
            },
          ],
        },
        { type: "input", bind: "when", kind: "date", label: "Start" },
        { type: "code", text: "budget = {{ budget }}", language: "python" },
      ],
    }),
    { onSendMessage },
  );
  expect(container.querySelector("dd")?.textContent).toBe("50 CHF");
  expect(container.textContent).toContain("1. Starter");
  expect(container.textContent).toContain("2. Pro");
  expect(container.textContent).not.toContain("Max");
  expect(container.textContent).toContain("budget = 50");
  expect(container.querySelector('input[type="date"]')).not.toBeNull();
  await act(async () => {
    buttonNamed("Pick Pro").click();
  });
  expect(onSendMessage).toHaveBeenCalledWith("I take Pro at 29");
});
