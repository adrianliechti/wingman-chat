// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatAnnouncementConfig } from "@/shared/config";
import { Markdown } from "@/shared/ui/Markdown";

vi.mock("@/shared/config", () => ({ getConfig: () => ({ chat: { announcement } }) }));

let announcement: ChatAnnouncementConfig | undefined;
let container: HTMLDivElement;
let root: Root;
let ChatAnnouncement: typeof import("./ChatAnnouncement").ChatAnnouncement;

beforeEach(async () => {
  vi.resetModules();
  ({ ChatAnnouncement } = await import("./ChatAnnouncement"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  announcement = { text: "Help shape **Lumen**. [Give feedback](https://example.com/survey)" };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<ChatAnnouncement />));
}

it.each([undefined, "", " \n "])("hides an absent or blank announcement: %j", async (value) => {
  announcement!.text = value;
  await render();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

it("hides an unconfigured announcement", async () => {
  announcement = undefined;
  await render();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

it("renders the configured title as plain text", async () => {
  announcement!.title = "  Help shape <Lumen>  ";
  await render();
  expect(document.body.querySelector("h2")?.textContent).toBe("Help shape <Lumen>");
  expect(document.body.querySelector("lumen")).toBeNull();
});

it.each([undefined, "", " \n "])("uses the default title when absent or blank: %j", async (value) => {
  announcement!.title = value;
  await render();
  expect(document.body.querySelector("h2")?.textContent).toBe("A quick note");
});

it("renders one Markdown message with formatting and links", async () => {
  await render();
  expect(document.body.querySelectorAll("p")).toHaveLength(1);
  expect(document.body.querySelector("p .font-semibold")?.textContent).toBe("Lumen");
  const link = document.body.querySelector("a")!;
  expect(link.textContent).toBe("Give feedback");
  expect(link.href).toBe("https://example.com/survey");
  expect(link.target).toBe("_blank");
  expect(link.rel).toContain("noopener");
  expect(link.rel).toContain("noreferrer");
});

it("supports paragraphs and lists without a link", async () => {
  announcement!.text = "**New features**\n\nYou can now:\n\n- Attach a file\n- Ask a question";
  await render();
  expect(document.body.querySelectorAll("p")).toHaveLength(2);
  expect([...document.body.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
    "Attach a file",
    "Ask a question",
  ]);
  expect(document.body.querySelector("a")).toBeNull();
});

it("automatically uses two columns for a standalone Markdown illustration", async () => {
  announcement!.text =
    "How is Lumen helping?\n\n- ![Time](/announcement/clock.svg) 5-minute survey\n\n![Feedback](/announcement/feedback.svg)";
  await render();
  const dialog = document.body.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector(".md\\:grid")).not.toBeNull();
  expect(dialog.querySelector("li")?.textContent).toContain("5-minute survey");
  expect(dialog.querySelector('li img[alt="Time"]')?.getAttribute("src")).toBe("/announcement/clock.svg");
  expect(dialog.querySelector('p > img[alt="Feedback"]')?.getAttribute("src")).toBe("/announcement/feedback.svg");
});

it.each([
  "A text-only announcement.",
  "- ![Time](/announcement/clock.svg) 5-minute survey",
  "Some text with an inline ![Image](/announcement/feedback.svg).",
  "```markdown\n![Example](/announcement/feedback.svg)\n```",
])("keeps a single column without a standalone image paragraph: %s", async (text) => {
  announcement!.text = text;
  await render();
  expect(document.body.querySelector('[role="dialog"] .md\\:grid')).toBeNull();
});

it("uses two columns for a reference-style illustration", async () => {
  announcement!.text = "Help shape Lumen.\n\n![Feedback][illustration]\n\n[illustration]: /announcement/feedback.svg";
  await render();
  const dialog = document.body.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector(".md\\:grid")).not.toBeNull();
  expect(dialog.querySelector('img[alt="Feedback"]')?.getAttribute("src")).toBe("/announcement/feedback.svg");
});

it("keeps announcement link overrides scoped away from ordinary chat Markdown", async () => {
  await act(async () =>
    root.render(
      <>
        <ChatAnnouncement />
        <div data-chat-message>
          <Markdown compact>{"[Chat link](https://example.com/chat)"}</Markdown>
        </div>
      </>,
    ),
  );
  const chatLink = document.body.querySelector("[data-chat-message] a")!;
  expect(chatLink.classList.contains("text-sky-700")).toBe(true);
  expect(chatLink.closest('[class*="[&_a]:text-inherit"]')).toBeNull();
  expect(document.body.querySelector('[role="dialog"] a')?.closest('[class*="[&_a]:text-inherit"]')).not.toBeNull();
});

async function clickButton(label: string) {
  const button = [...document.body.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

async function reopenChat() {
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
}

async function reloadPage() {
  await act(async () => root.unmount());
  vi.resetModules();
  ({ ChatAnnouncement } = await import("./ChatAnnouncement"));
  root = createRoot(container);
  await render();
}

it("opens an accessible dialog with dismissal actions", async () => {
  await render();
  const dialog = document.body.querySelector('[role="dialog"]')!;
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
  expect(title?.textContent).toBe("A quick note");
  expect(dialog.textContent).toContain("Got it");
  expect(dialog.textContent).toContain("Do not show again");
});

it("keeps Got it dismissed across chat remounts until a full reload", async () => {
  await render();
  await clickButton("Got it");
  await render();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  await reopenChat();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(localStorage.getItem("app_dismissed_chat_announcement")).toBeNull();
  await reloadPage();
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
});

it("can close an actionable announcement without following its link or dismissing it permanently", async () => {
  announcement!.action = { label: "Take the survey", url: "https://example.com/survey" };
  await render();
  expect([...document.body.querySelectorAll("button")].some((button) => button.textContent === "Got it")).toBe(false);
  const close = document.body.querySelector<HTMLButtonElement>('button[aria-label="Close announcement"]')!;
  await act(async () => close.click());
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  await reopenChat();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  await reloadPage();
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
});

it("remembers Do not show again across visits", async () => {
  await render();
  await clickButton("Do not show again");
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  await reopenChat();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  await reloadPage();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

it("shows updated announcement text after a persistent dismissal", async () => {
  await render();
  await clickButton("Do not show again");
  announcement!.text = "An updated announcement";
  await reopenChat();
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(announcement!.text);
});

it("shows an updated title after a persistent dismissal", async () => {
  await render();
  await clickButton("Do not show again");
  announcement!.title = "An updated announcement";
  await reopenChat();
  expect(document.body.querySelector("h2")?.textContent).toBe(announcement!.title);
});

it.each(["http://example.com/survey", " https://example.com/survey "])(
  "renders an action button that links to a web destination: %s",
  async (url) => {
    announcement!.action = { label: " Take the survey ", url };
    await render();
    const action = document.body.querySelector('a[target="_blank"][data-autofocus]')!;
    expect(action.textContent).toBe("Take the survey");
    expect(action.getAttribute("href")).toBe(url.trim());
    expect(action.getAttribute("rel")).toBe("noopener noreferrer");
    expect(document.body.querySelector("button[data-autofocus]")).toBeNull();
  },
);

it.each([
  { label: "", url: "https://example.com/survey" },
  { label: " \n ", url: "https://example.com/survey" },
  ...[
    "",
    " \n ",
    "not-a-url",
    "/survey",
    "https://",
    "javascript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,unsafe",
    "file:///tmp/survey",
  ].map((url) => ({ label: "Take the survey", url })),
])("hides actions with a blank label or invalid web URL: %j", async (action) => {
  announcement!.action = action;
  await render();
  expect(document.body.querySelector("a[data-autofocus]")).toBeNull();
  expect(document.body.querySelector("button[data-autofocus]")?.textContent).toBe("Got it");
});

it("closes the current announcement when following the action without permanently dismissing it", async () => {
  announcement!.action = { label: "Take the survey", url: "https://example.com/survey" };
  await render();
  const action = document.body.querySelector<HTMLAnchorElement>("a[data-autofocus]")!;
  action.addEventListener("click", (event) => event.preventDefault());
  await act(async () => action.click());
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  await reopenChat();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  await reloadPage();
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
});

it.each([
  { label: "Share feedback", url: "https://example.com/survey" },
  { label: "Take the survey", url: "https://example.com/new-survey" },
])("shows the announcement again when its action changes: %j", async (action) => {
  announcement!.action = { label: "Take the survey", url: "https://example.com/survey" };
  await render();
  await clickButton("Do not show again");
  await reopenChat();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  announcement!.action = action;
  await reopenChat();
  expect(document.body.querySelector("a[data-autofocus]")?.getAttribute("href")).toBe(action.url);
});

it("still opens and closes when browser storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  await render();
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  await clickButton("Do not show again");
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

it("uses the shared renderer's protection against unsafe HTML and link URLs", async () => {
  announcement!.text = "<script>alert(1)</script>\n\n[Click](javascript:alert(1))";
  await render();
  expect(document.body.querySelector("script")).toBeNull();
  expect(document.body.querySelector('a[href^="javascript:"]')).toBeNull();
});

it("resolves named images from the images map", async () => {
  announcement = {
    text: "- ![Time](clock) Quick\n\n![Hero](hero)\n\n![Bad](bad)",
    images: {
      clock: ' <svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg> ',
      hero: "https://example.com/hero.png",
      bad: "javascript:alert(1)",
    },
  };
  await render();
  const sources = Object.fromEntries(
    [...document.body.querySelectorAll("img")].map((img) => [img.alt, img.getAttribute("src")]),
  );
  expect(sources.Time).toBe(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>')}`,
  );
  expect(sources.Hero).toBe("https://example.com/hero.png");
  expect(sources.Bad).toBe("bad");
});
