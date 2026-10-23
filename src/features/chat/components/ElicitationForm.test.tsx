// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FormElicitation, UrlElicitation } from "@/shared/types/elicitation";
import { ChatMessageElicitation } from "./ChatMessageElicitation";

vi.mock("@/shared/ui/Markdown", () => ({ Markdown: ({ children }: { children: string }) => <div>{children}</div> }));
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
  vi.unstubAllGlobals();
});
const submit = async (form: HTMLFormElement) => {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};
const click = async (input: HTMLInputElement | HTMLButtonElement) => {
  await act(async () => input.click());
};

it("keeps remote schemas closed and requires an explicit boolean answer", async () => {
  const onResolve = vi.fn();
  const request: FormElicitation = {
    message: "Remote service",
    requestedSchema: {
      type: "object",
      properties: {
        consent: { type: "boolean", title: "Allow publication?" },
        format: {
          type: "string",
          title: "Format",
          oneOf: [
            { const: "pdf", title: "PDF" },
            { const: "html", title: "HTML" },
          ],
          default: "pdf",
        },
      },
      required: ["consent", "format"],
    },
  };
  await act(async () =>
    root.render(<ChatMessageElicitation toolName="remote" elicitation={request} onResolve={onResolve} />),
  );
  const no = container.querySelector<HTMLInputElement>('input[aria-label="No"]')!;
  expect(no.checked).toBe(false);
  expect(container.querySelector<HTMLInputElement>('input[aria-label="PDF"]')!.checked).toBe(true);
  expect(container.querySelector("textarea")).toBeNull();
  await submit(container.querySelector("form")!);
  expect(onResolve).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Choose Yes or No.");
  expect(document.activeElement).toBe(container.querySelector('input[aria-label="Yes"]'));
  await click(no);
  await submit(container.querySelector("form")!);
  expect(onResolve).toHaveBeenCalledExactlyOnceWith({ action: "accept", content: { consent: false, format: "pdf" } });
});

it("isolates identically named radio questions in simultaneous requests", async () => {
  const request: FormElicitation = {
    message: "Choose",
    requestedSchema: { type: "object", properties: { answer: { type: "boolean", title: "Confirm?" } } },
  };
  const first = vi.fn(),
    second = vi.fn();
  await act(async () =>
    root.render(
      <>
        <ChatMessageElicitation toolName="remote" elicitation={request} onResolve={first} />
        <ChatMessageElicitation toolName="remote" elicitation={request} onResolve={second} />
      </>,
    ),
  );
  const forms = container.querySelectorAll("form");
  const yes = forms[0].querySelector<HTMLInputElement>('input[aria-label="Yes"]')!;
  const no = forms[1].querySelector<HTMLInputElement>('input[aria-label="No"]')!;
  await click(yes);
  await click(no);
  expect(yes.checked).toBe(true);
  expect(no.checked).toBe(true);
  expect(yes.name).not.toBe(no.name);
  await submit(forms[0]);
  await submit(forms[1]);
  expect(first).toHaveBeenCalledWith({ action: "accept", content: { answer: true } });
  expect(second).toHaveBeenCalledWith({ action: "accept", content: { answer: false } });
});

it.each(["Decline", "Cancel"])("preserves the remote %s action without submitting values", async (label) => {
  const onResolve = vi.fn();
  await act(async () =>
    root.render(
      <ChatMessageElicitation
        toolName="remote"
        elicitation={{
          message: "Required",
          requestedSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
        }}
        onResolve={onResolve}
      />,
    ),
  );
  await click([...container.querySelectorAll("button")].find((button) => button.textContent === label)!);
  expect(onResolve).toHaveBeenCalledExactlyOnceWith({ action: label.toLowerCase() });
});

it("shows only the request itself for direct approval and resolves after an explicit action", async () => {
  const onResolve = vi.fn();
  const instructions = "Find **primary sources**\nhttps://example.test/?a=1&b=2";
  await act(async () =>
    root.render(
      <ChatMessageElicitation
        toolName="web_research"
        elicitation={{
          message: "Fallback for nonvisual clients",
          approval: {
            tool: "Web research",
            source: "Web Search",
            input: { instructions, max_sources: 8 },
            primary: ["instructions"],
          },
        }}
        onResolve={onResolve}
      />,
    ),
  );
  expect(container.querySelector("h3")?.textContent).toBe("Allow Web research?");
  expect(container.querySelector("p:not(h3 p)")?.textContent).toBe(instructions);
  expect(container.textContent).toContain("Web Search");
  expect(container.textContent).not.toContain("Max sources");
  expect(container.textContent).not.toContain("Fallback for nonvisual clients");
  expect(container.querySelector("details, pre")).toBeNull();
  expect(onResolve).not.toHaveBeenCalled();
  await click([...container.querySelectorAll("button")].find((button) => button.textContent === "Allow")!);
  expect(onResolve).toHaveBeenCalledExactlyOnceWith({ action: "accept", content: {} });
});

it("lists every argument when none reads as the request", async () => {
  await act(async () =>
    root.render(
      <ChatMessageElicitation
        toolName="remote"
        elicitation={{ message: "", approval: { tool: "Resize", input: { width: 640, keep_ratio: true } } }}
        onResolve={vi.fn()}
      />,
    ),
  );
  expect(container.textContent).toContain("Width640");
  expect(container.textContent).toContain("Keep ratioYes");
});

it.each(["Allow", "Decline", "Cancel"])("resolves a schema-free confirmation with %s", async (label) => {
  const onResolve = vi.fn();
  await act(async () =>
    root.render(
      <ChatMessageElicitation
        toolName="remote"
        elicitation={{ message: "Publish this report?", source: "Reports" }}
        onResolve={onResolve}
      />,
    ),
  );
  expect(container.textContent).toContain("Reports");
  await click([...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === label)!);
  expect(onResolve).toHaveBeenCalledExactlyOnceWith(
    label === "Allow" ? { action: "accept", content: {} } : { action: label.toLowerCase() },
  );
});

it("opens URL requests in a new tab and reopens while waiting without sending another answer", async () => {
  const onResolve = vi.fn();
  const elicitation: UrlElicitation = {
    mode: "url",
    message: "Connect your account",
    source: "Reports",
    url: "https://example.test/connect",
    elicitationId: "connect",
  };
  const render = async (waiting = false, completed = false) =>
    act(async () =>
      root.render(
        <ChatMessageElicitation
          toolName="remote"
          elicitation={elicitation}
          waiting={waiting}
          completed={completed}
          onResolve={onResolve}
        />,
      ),
    );
  const open = async () =>
    act(async () => {
      // Suppress navigation in the DOM harness; the real browser tests follow the link.
      const link = container.querySelector("a")!;
      link.addEventListener("click", (event) => event.preventDefault(), { once: true });
      link.click();
    });
  await render();
  expect(container.querySelector("a")?.getAttribute("href")).toBe(elicitation.url);
  expect(container.querySelector("a")?.target).toBe("_blank");
  expect(container.querySelector("a")?.rel).toBe("noopener noreferrer");
  await open();
  expect(onResolve).toHaveBeenCalledExactlyOnceWith({ action: "accept" });
  await render(true);
  expect(container.querySelector("a")?.textContent).toContain("Open again");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("updates automatically");
  expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Cancel"]);
  await open();
  expect(onResolve).toHaveBeenCalledOnce();
  await click(container.querySelector("button")!);
  expect(onResolve).toHaveBeenLastCalledWith({ action: "cancel" });
  await render(false, true);
  expect(container.querySelector("h3")?.textContent).toBe("Request completed");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Continuing");
  expect(container.querySelector("a, button")).toBeNull();
});
