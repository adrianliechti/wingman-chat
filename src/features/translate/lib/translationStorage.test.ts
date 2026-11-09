import { describe, expect, it } from "vitest";
import type { Translation } from "../types/translate";
import { hydrateTranslation, serializeTranslation, translationTitle } from "./translationStorage";

const base: Translation = {
  id: "t1",
  kind: "text",
  created: new Date("2026-01-02T00:00:00.000Z"),
  updated: new Date("2026-01-03T00:00:00.000Z"),
  provider: "llm",
  targetLang: "de",
  formality: "",
  style: "professional",
  sourceText: "Hello   world\nagain",
  translatedText: "Hallo Welt",
  translatedKey: "abc",
  resultText: "Hallo Welt.",
  status: "done",
};

describe("translation storage", () => {
  it("round-trips a text job and drops empty tone and style", () => {
    const stored = serializeTranslation(base);
    expect(stored).toMatchObject({ title: "Hello world again", formality: undefined, style: "professional" });
    expect(hydrateTranslation(stored)).toEqual(base);
  });

  it("reports a job that was still running when the page closed", () => {
    const stored = serializeTranslation({ ...base, status: "running" });
    expect(hydrateTranslation(stored)).toMatchObject({
      status: "error",
      error: "The translation was interrupted. Try again.",
    });
    expect(hydrateTranslation({ ...stored, status: "idle" }).status).toBe("error");
  });

  it("drops option values that are no longer offered", () => {
    const stored = { ...serializeTranslation(base), formality: "enthusiastic", style: "business" };
    expect(hydrateTranslation(stored)).toMatchObject({ formality: "", style: "" });
    expect(hydrateTranslation({ ...stored, formality: "informal", style: "plain" })).toMatchObject({
      formality: "informal",
      style: "plain",
    });
  });

  it("names documents after their file and texts after their first words", () => {
    expect(
      translationTitle({ kind: "file", sourceText: "", sourceFile: { name: "a.pdf", contentType: "", size: 1 } }),
    ).toBe("a.pdf");
    expect(translationTitle({ kind: "text", sourceText: "" })).toBe("New translation");
    expect(translationTitle({ kind: "text", sourceText: "x".repeat(100) })).toHaveLength(80);
  });

  it("keeps a file job's documents and tolerates missing dates", () => {
    const file: Translation = {
      ...base,
      kind: "file",
      sourceText: "",
      sourceFile: { name: "report.docx", contentType: "application/x", size: 3 },
      resultFile: { name: "report_de.docx", contentType: "application/x", size: 4 },
      translatedText: undefined,
      resultText: undefined,
    };
    const stored = serializeTranslation(file);
    expect(stored.sourceText).toBeUndefined();
    expect(hydrateTranslation(stored)).toEqual(file);
    const legacy = hydrateTranslation({ ...stored, created: "garbage", updated: undefined as unknown as string });
    expect(legacy.created.getTime()).toBe(0);
    expect(legacy.updated.getTime()).toBe(0);
  });
});
