// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("carousel questions", () => {
  const request: FormElicitation = {
    message: "",
    requestedSchema: {
      type: "object",
      properties: {
        format: { type: "string", title: "Which format?" },
        notes: { type: "string", title: "Any notes?" },
        publish: { type: "boolean", title: "Publish it?" },
      },
      required: ["notes"],
    },
    presentation: {
      kind: "questions",
      fieldOrder: ["format", "notes", "publish"],
      layout: "carousel",
      fields: {
        format: {
          allowOther: true,
          options: [
            { value: "brief", label: "Brief" },
            { value: "report", label: "Full report" },
          ],
        },
      },
    },
  };
  const render = async (elicitation: FormElicitation = request, onResolve = vi.fn()) => {
    await act(async () =>
      root.render(<ChatMessageElicitation toolName="ask_questions" elicitation={elicitation} onResolve={onResolve} />),
    );
    return onResolve;
  };
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === label);
  const press = (label: string) => click(button(label)!);
  const input = <T extends HTMLElement = HTMLInputElement>(selector: string) => container.querySelector<T>(selector)!;
  // A pointer press: mousedown then click, as a real mouse or touch sends.
  const pick = async (el: HTMLElement, detail = 1) =>
    act(async () => {
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
    });
  const type = async (el: HTMLTextAreaElement | HTMLInputElement, text: string) =>
    act(async () => {
      // The prototype setter bypasses React's value tracking, like real typing.
      Reflect.set(Object.getPrototypeOf(el) as object, "value", text, el);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const title = () => container.querySelector("h3")?.textContent;
  // Questions stay mounted while hidden, so check which one is actually shown.
  const shown = () =>
    [...container.querySelectorAll<HTMLElement>("[data-step]")].filter((el) => !el.hidden).map((el) => el.dataset.step);
  const review = () =>
    [...container.querySelectorAll("li")].map((row) => [...row.querySelectorAll("p")].map((p) => p.textContent));

  it("moves through questions, auto-advances on a pick, then reviews and submits", async () => {
    const onResolve = await render();
    expect(title()).toBe("Question 1 of 3");
    expect(shown()).toEqual(["0"]);
    expect(input('[role="progressbar"]').getAttribute("aria-valuetext")).toBe("Question 1 of 3");
    expect(button("Back")?.disabled).toBe(true);
    await pick(input('input[aria-label="Brief"]'));
    expect(title()).toBe("Question 2 of 3");
    expect(shown()).toEqual(["1"]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Question 2 of 3: Any notes?");
    expect(document.activeElement).toBe(input('textarea[aria-label="Any notes?"]'));
    expect(onResolve).not.toHaveBeenCalled();

    // Required question blocks Next until it is answered.
    await press("Next");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("This field is required.");
    expect(title()).toBe("Question 2 of 3");
    await type(input<HTMLTextAreaElement>('textarea[aria-label="Any notes?"]'), "Keep it short");
    await press("Next");
    expect(title()).toBe("Question 3 of 3");
    expect(button("Review")).toBeDefined();

    await pick(input('input[aria-label="No"]'));
    expect(title()).toBe("Review your answers");
    expect(shown()).toEqual([]);
    expect(input('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("3");
    expect(review()).toEqual([
      ["Which format?", "Brief"],
      ["Any notes?", "Keep it short"],
      ["Publish it?", "No"],
    ]);
    expect(onResolve).not.toHaveBeenCalled();

    await press("Submit");
    expect(onResolve).toHaveBeenCalledExactlyOnceWith({
      action: "accept",
      content: { format: "brief", notes: "Keep it short", publish: false },
    });
  });

  it("returns to the review after editing an answer, keeping typed text", async () => {
    await render();
    await pick(input('input[aria-label="Brief"]'));
    await type(input<HTMLTextAreaElement>('textarea[aria-label="Any notes?"]'), "Hi");
    await press("Next");
    await press("Review");
    expect(review()[2]).toEqual(["Publish it?", "Skipped"]);
    await click(input<HTMLButtonElement>('button[aria-label="Edit answer for Which format?"]'));
    expect(title()).toBe("Question 1 of 3");
    expect(button("Review")).toBeDefined();
    await pick(input('input[aria-label="Full report"]'));
    expect(title()).toBe("Review your answers");
    expect(review()[0]).toEqual(["Which format?", "Full report"]);

    // Back walks through the questions without losing anything.
    await press("Back");
    await press("Back");
    expect(title()).toBe("Question 2 of 3");
    expect(input<HTMLTextAreaElement>('textarea[aria-label="Any notes?"]').value).toBe("Hi");
    await press("Back");
    expect(input('input[aria-label="Full report"]').checked).toBe(true);
  });

  it("advances on a re-click of the selected option", async () => {
    await render();
    await pick(input('input[aria-label="Brief"]'));
    await press("Back");
    await pick(input('input[aria-label="Brief"]'));
    expect(title()).toBe("Question 2 of 3");
  });

  it("does not auto-advance for keyboard selection, typed answers or multi-select", async () => {
    await render({
      ...request,
      requestedSchema: {
        type: "object",
        properties: {
          format: { type: "string", title: "Which format?" },
          tags: { type: "array", title: "Tags?", items: { type: "string" } },
          count: { type: "number", title: "How many?" },
        },
      },
      presentation: {
        ...request.presentation!,
        fieldOrder: ["format", "tags", "count"],
        fields: {
          ...request.presentation!.fields,
          tags: { options: [{ value: "a", label: "A" }], allowOther: false },
        },
      },
    });
    // Arrow keys select a radio with a click that has no pointer press before it.
    await click(input('input[aria-label="Full report"]'));
    expect(input('input[aria-label="Full report"]').checked).toBe(true);
    expect(title()).toBe("Question 1 of 3");
    await type(input<HTMLTextAreaElement>('textarea[aria-label="Your answer for Which format?"]'), "Slides");
    expect(title()).toBe("Question 1 of 3");
    await press("Next");
    await pick(input('input[aria-label="A"]'));
    expect(input('input[aria-label="A"]').checked).toBe(true);
    expect(title()).toBe("Question 2 of 3");
    await press("Next");
    await type(input('input[aria-label="How many?"]'), "4");
    expect(title()).toBe("Question 3 of 3");
  });

  it("ignores the second click of a double-click", async () => {
    const onResolve = await render();
    await pick(input('input[aria-label="Brief"]'));
    // The second click lands on the next question's control; it must not answer it.
    await press("Back");
    await pick(input('input[aria-label="Brief"]'), 2);
    expect(title()).toBe("Question 1 of 3");

    await pick(input('input[aria-label="Brief"]'));
    await type(input<HTMLTextAreaElement>('textarea[aria-label="Any notes?"]'), "Hi");
    await press("Next");
    await press("Review");
    // The second click on "Review" lands on "Submit" and must not skip the review.
    await act(async () => {
      button("Submit")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 }));
    });
    expect(onResolve).not.toHaveBeenCalled();
    expect(title()).toBe("Review your answers");
  });

  it("does not answer the next question with the second click of a double-click", async () => {
    await render({
      ...request,
      requestedSchema: {
        type: "object",
        properties: {
          first: { type: "boolean", title: "First question?" },
          second: { type: "boolean", title: "Second question?" },
        },
      },
      presentation: { ...request.presentation!, fieldOrder: ["first", "second"], fields: {} },
    });
    await pick(input('[data-step="0"] input[aria-label="Yes"]'));
    await pick(input('[data-step="1"] input[aria-label="No"]'), 2);
    expect(title()).toBe("Question 2 of 2");
    expect(input('[data-step="1"] input[aria-label="No"]').checked).toBe(false);
    await press("Review");
    expect(review()[1]).toEqual(["Second question?", "Skipped"]);
  });

  it("focuses the selected option when returning to a question", async () => {
    await render();
    await pick(input('input[aria-label="Full report"]'));
    await press("Back");
    expect(document.activeElement).toBe(input('input[aria-label="Full report"]'));
  });

  it("ignores held Enter in a number input after advancing", async () => {
    await render({
      ...request,
      requestedSchema: {
        type: "object",
        properties: {
          first: { type: "number", title: "First count?" },
          second: { type: "number", title: "Second count?" },
        },
      },
      presentation: { ...request.presentation!, fieldOrder: ["first", "second"], fields: {} },
    });
    await type(input('input[aria-label="First count?"]'), "1");
    await submit(container.querySelector("form")!);
    const repeat = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
    await act(async () => {
      // Browsers implicitly submit number inputs when Enter is not cancelled.
      if (input('input[aria-label="Second count?"]').dispatchEvent(repeat))
        container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(repeat.defaultPrevented).toBe(true);
    expect(title()).toBe("Question 2 of 2");
  });

  it("preserves Enter key repeats in written answers", async () => {
    await render();
    await pick(input('input[aria-label="Brief"]'));
    const repeat = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
    await act(async () => {
      input<HTMLTextAreaElement>('textarea[aria-label="Any notes?"]').dispatchEvent(repeat);
    });
    expect(repeat.defaultPrevented).toBe(false);
    expect(title()).toBe("Question 2 of 3");
  });

  it("labels Skip as skipping the whole set", async () => {
    const onResolve = await render();
    await press("Skip all");
    expect(onResolve).toHaveBeenCalledExactlyOnceWith({ action: "decline" });
  });

  it("falls back to the single-card form for one question", async () => {
    await render({
      ...request,
      requestedSchema: { type: "object", properties: { notes: request.requestedSchema!.properties.notes } },
      presentation: { ...request.presentation!, fieldOrder: ["notes"] },
    });
    expect(title()).toBe("A quick question");
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(button("Continue")).toBeDefined();
  });

  it("keeps the single-card form for non-carousel requests", async () => {
    await render({ ...request, presentation: { ...request.presentation!, layout: "form" } });
    expect(title()).toBe("A few quick questions");
    expect(shown()).toEqual(["0", "1", "2"]);
    expect(button("Continue")).toBeDefined();
    expect(button("Skip")).toBeDefined();
  });
});
