import { describe, expect, it } from "vitest";
import { skillRefPart, promptText, text, userMessage } from "@/shared/lib/messages";
import { availableSkills, matchingSkills, skillTrigger } from "./skillAutocomplete";

describe("skill autocomplete", () => {
  it("finds a slash token at the caret and preserves text after it", () => {
    const content = "Please /draft then send";
    expect(skillTrigger(content, 13)).toEqual({ start: 7, end: 13, query: "draft" });
    expect(skillTrigger("/support:draft", 14)?.query).toBe("support:draft");
    expect(skillTrigger("/", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it.each(["https://example.com/path", "/tmp/file", "hello@example.com", "\`/draft", "\`\`\`sh\n/draft", "a /draft "])(
    "ignores non-command context: %s",
    (value) => {
      expect(skillTrigger(value, value.length)).toBeNull();
    },
  );

  it("ignores selected text", () => {
    expect(skillTrigger("/draft", 0, 6)).toBeNull();
  });

  it("replaces the entire slash token when completing from its middle", () => {
    expect(skillTrigger("Use /draft-response here", 8)).toEqual({ start: 4, end: 19, query: "dra" });
  });

  it("filters by name and description, ranking a name match first", () => {
    const skills = [
      { name: "support:reply", description: "Draft a response", content: "Reply" },
      { name: "draft-response", description: "Write replies", content: "Draft" },
      { name: "research", description: "Find information", content: "Research" },
    ];
    expect(matchingSkills(skills, "DRAFT").map((s) => s.name)).toEqual(["draft-response", "support:reply"]);
    expect(matchingSkills(skills, "unknown")).toEqual([]);
  });

  it("lists personal and installed-plugin skills with distinct names, without adding Studio", () => {
    const skill = { name: "draft-response", description: "Reply", content: "Instructions" };
    const skills = availableSkills(
      [skill],
      [{ id: "support", hubUrl: "https://example.test", installedAt: "2026-01-01", skills: [skill] }],
    );
    expect(skills.map((s) => s.name)).toEqual(["draft-response", "support:draft-response"]);
    expect(skills[1].description).toBe("Reply");
  });

  it("keeps a selected skill out of the typed prompt but includes its exact name for the model", () => {
    const part = skillRefPart("support:draft-response");
    const message = userMessage([text("Answer this"), part]);
    expect(promptText(message)).toBe("Answer this");
    expect(part.content).toContain("support:draft-response");
    expect(part.content).toContain("load_skill");
  });
});
