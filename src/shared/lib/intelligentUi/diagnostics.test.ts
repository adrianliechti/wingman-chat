import { describe, expect, it } from "vitest";
import { assistantMessage, userMessage } from "../messages";
import { collectUiDiagnostics, extractUiFences, uiDiagnostics, uiFeedback } from "./diagnostics";

const good = '```ui\n{"children": [{"type": "text", "text": "hi"}]}\n```';
const broken = '```ui\n{"children": [{"type": "hologram"}, {"type": "slider", "label": "x"}]}\n```';
const invalid = "```ui\n{not json\n```";
const typo = '```ui\n{"state": {"guests": 2}, "children": [{"type": "text", "text": "{{ guest }}"}]}\n```';
const unrunnable =
  '```ui\n{"state": {"a": 2}, "computed": {"b": "a.toFixed(1)"}, "children": [{"type": "text", "text": "{{ nope(a) }}"}]}\n```';

describe("extractUiFences", () => {
  it("finds ui fences and ignores other code blocks", () => {
    const text = `Intro\n\n${good}\n\n\`\`\`json\n{}\n\`\`\`\n\n~~~wingman-ui\n[]\n~~~\n`;
    expect(extractUiFences(text)).toEqual(['{"children": [{"type": "text", "text": "hi"}]}', "[]"]);
  });
});

describe("collectUiDiagnostics", () => {
  it("is empty for valid blocks and lists problems otherwise", () => {
    expect(collectUiDiagnostics(good)).toEqual([]);
    expect(collectUiDiagnostics(typo)).toEqual(["ui block 1: references undeclared state keys: guest"]);
    expect(collectUiDiagnostics(unrunnable)).toEqual([
      'ui block 1: computed "b": Unexpected token "("; {{ nope(a) }}: Unknown function "nope"',
    ]);
    expect(collectUiDiagnostics(`${good}\n${broken}\n${invalid}`)).toEqual([
      'ui block 2: Unknown component "hologram"; A slider needs a "bind" state key',
      expect.stringMatching(/^ui block 3: not rendered, /),
    ]);
  });
});

describe("uiDiagnostics", () => {
  const history = [
    userMessage("Plan dinner"),
    assistantMessage(`Here you go\n${broken}`),
    userMessage("It shows an error"),
  ];

  it("adds a note about the previous turn to the first model call only", () => {
    const middleware = uiDiagnostics(history);
    const first = middleware.onConfig?.(
      { phase: "beforeModel" } as never,
      { messages: [{ role: "user", content: "It shows an error" }] } as never,
    ) as { providerMessages: { role: string; content: string }[] } | undefined;
    expect(first?.providerMessages).toHaveLength(2);
    expect(first?.providerMessages[1].content).toContain('Unknown component "hologram"');
    expect(first?.providerMessages[1].content).toContain("corrected block");

    const second = middleware.onConfig?.({ phase: "beforeModel" } as never, { messages: [] } as never);
    expect(second).toBeUndefined();
  });

  it("stays silent when the previous turn rendered or there is no previous turn", () => {
    expect(uiFeedback([userMessage("Plan dinner"), assistantMessage(good), userMessage("Thanks")])).toBe("");
    expect(uiFeedback([userMessage("Plan dinner")])).toBe("");
    // Only the turn right before the latest prompt counts.
    expect(
      uiFeedback([
        userMessage("a"),
        assistantMessage(broken),
        userMessage("b"),
        assistantMessage("Fixed in text"),
        userMessage("c"),
      ]),
    ).toBe("");
  });
});
