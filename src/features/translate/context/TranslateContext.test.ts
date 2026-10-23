import { describe, expect, it, vi } from "vitest";
import { isSupportedFile, pickLanguage, supportedLanguages, supportedProviders } from "./TranslateContext";

vi.mock("@/shared/config", () => ({
  getConfig: () => ({
    translator: {
      files: [".pdf"],
      languages: ["en", "de"],
      providers: [{ id: "llm" }, { id: "google", name: "Google", files: [".docx"], languages: ["ja", "fr"] }],
    },
  }),
}));

describe("translator providers", () => {
  it("falls back to translator-wide files and languages", () => {
    expect(supportedProviders()).toMatchObject([
      { id: "llm", name: "llm", files: [".pdf"], languages: ["en", "de"] },
      { id: "google", name: "Google", files: [".docx"], languages: ["ja", "fr"] },
    ]);
    expect(supportedLanguages("google").map((language) => language.code)).toEqual(["ja", "fr"]);
    expect(supportedLanguages("google")[0]).toMatchObject({ name: "Japanese", nativeName: "日本語" });
    expect(isSupportedFile(new File([], "a.docx"), "google")).toBe(true);
    expect(isSupportedFile(new File([], "a.docx"), "llm")).toBe(false);
  });

  it("keeps the current language, else prefers English, else the first", () => {
    expect(pickLanguage(["en", "de"], "de")).toBe("de");
    expect(pickLanguage(["fr", "en"], "ja")).toBe("en");
    expect(pickLanguage(["ja", "fr"], "de")).toBe("ja");
    expect(pickLanguage([])).toBe("");
  });
});
