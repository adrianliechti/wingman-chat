// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FormElicitation } from "@/shared/types/elicitation";
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
