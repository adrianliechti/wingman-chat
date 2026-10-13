// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { assistantMessage } from "@/shared/lib/messages";
import { ChatToolGroup } from "./ChatToolGroup";
import { createSkillsProvider } from "@/features/skills/lib/skillsProvider";

vi.mock("@/features/chat/hooks/useChat", () => ({
  useChatConversation: () => ({ chat: null, messages: [] }),
  useChatActions: () => ({ sendMessage: vi.fn() }),
}));
vi.mock("@/features/tools/hooks/useToolsContext", () => ({ useToolsContext: () => ({ providers: [skills] }) }));
vi.mock("@/shared/ui/CodeRenderer", () => ({ CodeRenderer: ({ code }: { code: string }) => <pre>{code}</pre> }));
vi.mock("@/shared/ui/Markdown", () => ({ Markdown: ({ children }: { children: string }) => <div>{children}</div> }));

let root: Root, container: HTMLDivElement;
const skills = createSkillsProvider(
  [
    {
      name: "inline-ui",
      description: "Fixture",
      loadContent: () => "",
      resources: ["guide.md"],
      loadResource: () => "",
    },
  ],
  { id: "skills", name: "Skills", description: "Fixture" },
)!;
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

it("starts collapsed and preserves ordered thoughts and independently expandable tool details", async () => {
  const messages = [
    assistantMessage([
      { type: "thinking", content: "Choose a skill" },
      { type: "tool-call", id: "skill", name: "load_skill", arguments: '{"name":"inline-ui"}', state: "complete" },
      {
        type: "tool-result",
        toolCallId: "skill",
        content: JSON.stringify({ content: "Skill instructions" }),
        state: "complete",
      },
      { type: "thinking", content: "Read its resources" },
      { type: "tool-call", id: "resource", name: "read_skill_resource", arguments: "{}", state: "complete" },
      {
        type: "tool-result",
        toolCallId: "resource",
        content: JSON.stringify({ content: "Resource content", path: "guide.md" }),
        state: "complete",
      },
    ]),
  ];
  await act(async () => root.render(<ChatToolGroup messages={messages} indices={[0]} />));
  const disclosure = container.querySelector("button")!;
  expect(disclosure.textContent).toBe("Used 2 tools and 2 thoughts");
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelectorAll("button")).toHaveLength(1);

  await act(async () => disclosure.click());
  const rows = [...container.querySelectorAll("button")];
  expect(rows.slice(1).map((row) => row.textContent)).toEqual([
    "Thought",
    "Read skillinline-ui",
    "Thought",
    "Read skill resource",
  ]);
  for (const row of rows.slice(1)) expect(row.querySelectorAll("svg")).toHaveLength(2);
  await act(async () => rows[1].click());
  await act(async () => rows[2].click());
  expect(container.textContent).toContain("Choose a skill");
  expect(container.textContent).toContain("Skill instructions");
  expect(rows[4].getAttribute("aria-expanded")).toBe("false");
  await act(async () => disclosure.click());
  expect(container.querySelectorAll("button")).toHaveLength(1);
});
