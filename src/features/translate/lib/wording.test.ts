import { describe, expect, it } from "vitest";
import { formalityOptions, knownFormality, knownStyle, styleOptions, wordingInstructions } from "./wording";

describe("formality", () => {
  it("is offered where the language addresses a reader formally or informally, in that language's words", () => {
    expect(formalityOptions("de")).toEqual([
      { value: "", label: "Automatic", description: "Follows the original text" },
      { value: "formal", label: "Formal", description: "Addresses the reader as “Sie”" },
      { value: "informal", label: "Informal", description: "Addresses the reader as “du”" },
    ]);
    expect(formalityOptions("fr-CH").map((option) => option.description)).toEqual([
      "Follows the original text",
      "Addresses the reader as “vous”",
      "Addresses the reader as “tu”",
    ]);
  });

  it("is not offered for a language without the distinction", () => {
    expect(formalityOptions("en")).toEqual([]);
    expect(formalityOptions("en-GB")).toEqual([]);
    expect(formalityOptions("sv")).toEqual([]);
    expect(formalityOptions("")).toEqual([]);
  });

  it("is a speech style in Japanese and Korean, named polite and plain", () => {
    expect(formalityOptions("ja").map((option) => [option.label, option.description])).toEqual([
      ["Automatic", "Follows the original text"],
      ["Polite", "Speech style: です・ます"],
      ["Plain", "Speech style: だ・である"],
    ]);
    expect(formalityOptions("ko").map((option) => option.label)).toEqual(["Automatic", "Polite", "Plain"]);
  });
});

describe("style", () => {
  it("offers the styles translators commonly name, each with what it does", () => {
    expect(styleOptions().map((option) => option.label)).toEqual([
      "Automatic",
      "Simple",
      "Business",
      "Academic",
      "Casual",
    ]);
    for (const option of styleOptions()) expect(option.description).not.toBe("");
  });

  it("keeps stored choices under their current names", () => {
    expect(["plain", "professional", "casual", "natural", "technical", "", undefined].map(knownStyle)).toEqual([
      "simple",
      "business",
      "casual",
      "",
      "",
      "",
      "",
    ]);
    expect(["formal", "informal", "more", "", undefined].map(knownFormality)).toEqual([
      "formal",
      "informal",
      "",
      "",
      "",
    ]);
  });
});

describe("rewrite instructions", () => {
  it("asks for nothing when both are automatic", () => {
    expect(wordingInstructions("de", "", "")).toEqual([]);
  });

  it("names the form of address to use", () => {
    const [formal] = wordingInstructions("de", "formal", "");
    expect(formal).toContain("Formal address");
    expect(formal).toContain("“Sie”");
    expect(wordingInstructions("es", "informal", "")[0]).toContain("“tú”");
    expect(wordingInstructions("ja", "formal", "")[0]).toContain("Polite speech style (です・ます)");
    expect(wordingInstructions("ja", "informal", "")[0]).toContain("Plain speech style (だ・である)");
  });

  it("leaves formality out for a language that has none", () => {
    expect(wordingInstructions("en", "formal", "")).toEqual([]);
  });

  it("names the target language in a style and protects the form of address when only a style is chosen", () => {
    const instructions = wordingInstructions("de-CH", "", "business");
    expect(instructions).toHaveLength(2);
    expect(instructions[0]).toContain("Business writing");
    expect(instructions[0]).toContain("Swiss High German");
    expect(instructions[1]).toBe("Keep the form of address (Sie or du) the text already uses.");
    // English has no form of address to protect.
    expect(wordingInstructions("en", "", "casual")).toEqual([expect.stringContaining("Casual writing")]);
  });

  it("combines a formality with a style without the protection clause", () => {
    const instructions = wordingInstructions("fr", "informal", "simple");
    expect(instructions).toHaveLength(2);
    expect(instructions[0]).toContain("“tu”");
    expect(instructions[1]).toContain("Simple language");
  });

  it("still applies a style stored under its old name", () => {
    expect(wordingInstructions("en", "", "plain")).toEqual([expect.stringContaining("Simple language")]);
  });
});
