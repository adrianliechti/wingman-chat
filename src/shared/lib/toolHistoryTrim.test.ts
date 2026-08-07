import { describe, expect, it } from "vitest";
import { Role, type Message } from "../types/chat";
import { containsElidedText, elideToolArguments, trimBulkyToolHistory } from "./toolHistoryTrim";

const skillBody = "# HVB review deck\n\n".padEnd(15_414, "Step one is to open the prior-month booklet. ");

function userMessage(text: string): Message {
  return { role: Role.User, content: [{ type: "text", text }] };
}

describe("bulky tool history trimming", () => {
  it("recognises its own marker so an elided value can never be written back", () => {
    const elided = elideToolArguments(JSON.stringify({ name: "hvb-review-deck-pptx", content: skillBody }));

    expect(elided.length).toBeLessThan(1000);
    expect(containsElidedText(elided)).toBe(true);
    // The untouched original must not trip the guard.
    expect(containsElidedText(JSON.stringify({ name: "hvb-review-deck-pptx", content: skillBody }))).toBe(false);
  });

  it("shortens an earlier create_skill call but leaves the stored conversation intact", () => {
    const create = JSON.stringify({ name: "hvb-review-deck-pptx", content: skillBody });
    const conversation: Message[] = [
      userMessage("save this as a skill"),
      { role: Role.Assistant, content: [{ type: "tool_call", id: "c1", name: "create_skill", arguments: create }] },
      userMessage("now add a section about QA"),
      userMessage("actually make it two sections"),
    ];

    const prepared = trimBulkyToolHistory(conversation);
    const preparedCall = prepared[1].content[0];

    expect(preparedCall.type === "tool_call" && containsElidedText(preparedCall.arguments)).toBe(true);
    // prepareMessages must not mutate what gets persisted.
    const storedCall = conversation[1].content[0];
    expect(storedCall.type === "tool_call" && storedCall.arguments).toBe(create);
  });

  it("keeps the in-progress turn at full fidelity so a fresh call is never shortened", () => {
    const create = JSON.stringify({ name: "hvb-review-deck-pptx", content: skillBody });
    const conversation: Message[] = [
      userMessage("save this as a skill"),
      { role: Role.Assistant, content: [{ type: "tool_call", id: "c1", name: "create_skill", arguments: create }] },
    ];

    const prepared = trimBulkyToolHistory(conversation);
    const preparedCall = prepared[1].content[0];

    expect(preparedCall.type === "tool_call" && preparedCall.arguments).toBe(create);
  });
});
