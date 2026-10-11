// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UiRenderer, InlineUiProvider } from "./UiRenderer";
import { BASIC_CATALOG_ID, WINGMAN_CATALOG_ID, basicCatalog, wingmanCatalog } from "@/shared/lib/inlineUi/catalog";
import { basicRenderers, customRenderers } from "./NodeView";
import fixtures from "@/shared/lib/inlineUi/fixtures/components.json";
import { Markdown } from "@/shared/ui/Markdown";

vi.mock("@/shell/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light", isDark: false, setTheme: () => {} }) }));
vi.mock("@/shared/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/shared/lib/confirm", () => ({ confirm: vi.fn(async () => true) }));
vi.mock("@/shared/ui/inlineUi/UiChart", () => ({
  UiChart: ({ data }: { data: unknown }) => <div data-testid="chart">{JSON.stringify(data)}</div>,
}));

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
const render = async (source: unknown, props: Partial<Parameters<typeof UiRenderer>[0]> = {}) => {
  await act(async () => root.render(<UiRenderer source={JSON.stringify(source)} {...props} />));
};
const create = (components: unknown[], dataModel: Record<string, unknown> = {}) => ({
  version: "v1.0",
  createSurface: { surfaceId: "main", catalogId: BASIC_CATALOG_ID, components, dataModel },
});
const input = (element: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
};

it.each(Object.entries(fixtures))("renders the registered %s component", async (name, fixture) => {
  await render(fixture);
  expect(container.querySelector(`[data-a2ui-component="${name}"]`)).not.toBeNull();
  expect(container.textContent).not.toContain("Interface could not be rendered");
  expect(container.textContent).not.toContain("could not be displayed");
  expect(container.textContent).not.toContain("Unsupported component");
});

it("has an explicit renderer for every component in each catalog", () => {
  expect(Object.keys(basicRenderers).sort()).toEqual([...basicCatalog.components.keys()].sort());
  expect(Object.keys(customRenderers).sort()).toEqual([...wingmanCatalog.components.keys()].sort());
});

it.each(["Button", "Form"] as const)("shows %s action progress and prevents duplicate submissions", async (name) => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const onSubmit = vi.fn(() => pending);
  const source = JSON.stringify(fixtures[name]);
  await act(async () =>
    root.render(
      <InlineUiProvider blocks={[{ key: "action", source }]} onSubmit={onSubmit}>
        <UiRenderer source={source} stateKey="action" />
      </InlineUiProvider>,
    ),
  );
  const button = container.querySelector<HTMLButtonElement>(`[data-a2ui-component="${name}"] button`)!;
  await act(async () => {
    button.click();
    button.click();
  });
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.textContent).toContain("Working…");
  await act(async () => finish());
  expect(button.disabled).toBe(false);
  expect(button.hasAttribute("aria-busy")).toBe(false);
  expect(button.textContent).not.toContain("Working…");
});

it("keeps failed action details collapsed and allows an explicit retry", async () => {
  const onSendMessage = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connection unavailable (E_NETWORK)"))
    .mockResolvedValue(undefined);
  await render(fixtures.Button, { onSendMessage });
  const button = container.querySelector<HTMLButtonElement>('[data-a2ui-component="Button"] button')!;
  await act(async () => button.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("This action could not be completed.");
  expect(container.textContent).not.toContain("E_NETWORK");
  expect(button.disabled).toBe(false);
  const details = container.querySelector("details")!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  expect(container.textContent).toContain("E_NETWORK");
  await act(async () => button.click());
  expect(onSendMessage).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("keeps invalid surface source behind technical details and recovers after correction", async () => {
  const invalid = { version: "v1.0", createSurface: { surfaceId: "bad", catalogId: "urn:unknown:catalog" } };
  await render(invalid);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("This interface could not be displayed.");
  expect(container.querySelector("pre")).toBeNull();
  expect(container.textContent).not.toContain("urn:unknown:catalog");
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  expect(container.textContent).toContain("urn:unknown:catalog");
  await render(fixtures.Text);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Hello");
});

it.each(["ui", "a2ui", "wingman-ui"])("renders %s messages through Markdown", async (language) => {
  await act(async () =>
    root.render(<Markdown>{`\`\`\`${language}\n${JSON.stringify(fixtures.Text)}\n\`\`\``}</Markdown>),
  );
  expect(container.textContent).toContain("Hello");
});

it("edits repeated nested fields and resolves action context at click time", async () => {
  const onSendMessage = vi.fn();
  await render(
    create(
      [
        { id: "root", component: "Column", children: ["list", "button"] },
        { id: "list", component: "List", children: { path: "/people", componentId: "person" } },
        { id: "person", component: "TextField", label: "Name", value: { "@path": "name" } },
        {
          id: "button",
          component: "Button",
          child: "label",
          action: { event: { name: "save", context: { people: { "@path": "/people" } } } },
        },
        { id: "label", component: "Text", text: "Save" },
      ],
      { people: [{ name: "Ada" }, { name: "Grace" }] },
    ),
    { onSendMessage },
  );
  const fields = container.querySelectorAll("input");
  expect(fields[1].value).toBe("Grace");
  await act(async () => input(fields[1], "Katherine"));
  expect(fields[0].value).toBe("Ada");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-a2ui-component="Button"] button')!.click());
  const submission = JSON.parse(onSendMessage.mock.calls[0][0]);
  expect(submission.message.action.context.people).toEqual([{ name: "Ada" }, { name: "Katherine" }]);
});

it("keeps controls disabled while streaming and updates a calculation locally", async () => {
  const source = create(
    [
      { id: "root", component: "Column", children: ["input", "total"] },
      { id: "input", component: "Slider", label: "Seats", min: 0, max: 10, value: { "@path": "/seats" } },
      {
        id: "total",
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
  );
  await render(source, { isStreaming: true });
  expect(container.querySelector("input")!.disabled).toBe(true);
  await render(source);
  await act(async () => input(container.querySelector("input")!, "4"));
  expect(container.querySelector(".text-2xl")?.textContent).toBe("48");
});

it("keeps standard numeric text inputs as strings and ChoicePicker values as arrays", async () => {
  const onSendMessage = vi.fn();
  await render(
    create(
      [
        { id: "root", component: "Column", children: ["input", "choice", "button"] },
        { id: "input", component: "TextField", label: "Amount", variant: "number", value: { "@path": "/amount" } },
        {
          id: "choice",
          component: "ChoicePicker",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
          value: { "@path": "/choice" },
        },
        {
          id: "button",
          component: "Button",
          child: "label",
          action: {
            event: { name: "save", context: { amount: { "@path": "/amount" }, choice: { "@path": "/choice" } } },
          },
        },
        { id: "label", component: "Text", text: "Save" },
      ],
      { amount: "3", choice: ["a"] },
    ),
    { onSendMessage },
  );
  await act(async () => {
    input(container.querySelector('input[type="number"]')!, "42");
    container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click();
  });
  await act(async () => container.querySelector<HTMLButtonElement>('[data-a2ui-component="Button"] button')!.click());
  expect(JSON.parse(onSendMessage.mock.calls[0][0]).message.action.context).toEqual({ amount: "42", choice: ["b"] });
});

it("shows standard validation on blur and gates a form submission", async () => {
  const onSendMessage = vi.fn();
  const check = {
    condition: { "@call": "email", args: { value: { "@path": "/email" } } },
    message: "Enter a valid email",
  };
  await render(
    create(
      [
        {
          id: "root",
          component: "Form",
          catalogId: WINGMAN_CATALOG_ID,
          children: ["email"],
          submit: "Save",
          action: { event: { name: "save", context: {} } },
        },
        { id: "email", component: "TextField", label: "Email", value: { "@path": "/email" }, checks: [check] },
      ],
      { email: "bad" },
    ),
    { onSendMessage },
  );
  const field = container.querySelector("input")!;
  expect(field.getAttribute("aria-invalid")).toBeNull();
  await act(async () => field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(field.getAttribute("aria-invalid")).toBe("true");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(onSendMessage).not.toHaveBeenCalled();
  await act(async () => input(field, "ada@example.com"));
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(onSendMessage).toHaveBeenCalledTimes(1);
});

it("updates the original surface across separate transcript blocks", async () => {
  const first = { key: "one", source: JSON.stringify(fixtures.Text) };
  const second = {
    key: "two",
    source: JSON.stringify({
      version: "v1.0",
      updateComponents: { surfaceId: "fixture-Text", components: [{ id: "root", component: "Text", text: "Updated" }] },
    }),
  };
  await act(async () =>
    root.render(
      <InlineUiProvider blocks={[first, second]}>
        <UiRenderer source={first.source} stateKey="one" />
        <UiRenderer source={second.source} stateKey="two" />
      </InlineUiProvider>,
    ),
  );
  expect(container.textContent).toContain("Updated");
  expect(container.textContent).not.toContain("Hello");
  expect(container.querySelectorAll('[data-a2ui-component="Text"]')).toHaveLength(1);
});
