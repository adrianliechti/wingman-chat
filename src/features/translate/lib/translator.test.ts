import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/shared/lib/client";
import { fingerprint, rewrite, translatedFileName, translateFile, translateText } from "./translator";

const translate = vi.fn<(...args: any[]) => Promise<string | Blob>>();
const rewriteText = vi.fn<(...args: any[]) => Promise<string>>(async () => "rewritten");
const client = { translate, rewriteText };

describe("translating text", () => {
  it("sends the text and leaves tone and style to rewrite", async () => {
    translate.mockResolvedValueOnce("Hallo");
    await expect(
      translateText(client, {}, { text: "Hello", provider: "llm", targetLang: "de" }, undefined),
    ).resolves.toBe("Hallo");
    expect(translate.mock.calls[0].slice(0, 3)).toEqual(["llm", "de", "Hello"]);
    expect(rewriteText).not.toHaveBeenCalled();
  });

  it("decodes a translator that answers with bytes", async () => {
    translate.mockResolvedValueOnce(new Blob([new TextEncoder().encode("Bonjour")]));
    await expect(translateText(client, {}, { text: "Hello", provider: "", targetLang: "fr" })).resolves.toBe("Bonjour");
  });

  it("refuses text over the configured length", async () => {
    await expect(
      translateText(client, { maxTextLength: 3 }, { text: "Hello", provider: "", targetLang: "de" }),
    ).rejects.toThrow("over the 3 limit");
    expect(translate).not.toHaveBeenCalled();
  });

  it("rewrites only when a formality, style or instruction is given, passing the source as reference", async () => {
    await expect(rewrite(client, { model: "m" }, "Hallo", "de", {})).resolves.toBe("Hallo");
    expect(rewriteText).not.toHaveBeenCalled();
    await expect(
      rewrite(client, { model: "m" }, "Hallo", "de", {
        formality: "formal",
        instruction: " shorter ",
        source: "Hello",
      }),
    ).resolves.toBe("rewritten");
    expect(rewriteText).toHaveBeenCalledWith(
      "m",
      "Hallo",
      { lang: "de", formality: "formal", instruction: " shorter ", source: "Hello" },
      { signal: undefined },
    );
  });

  it("fingerprints the request, not its length alone", () => {
    expect(fingerprint(["a", "de"])).toBe(fingerprint(["a", "de"]));
    expect(fingerprint(["a", "de"])).not.toBe(fingerprint(["b", "de"]));
  });
});

describe("translating files", () => {
  const docx = new File([new Uint8Array([1, 2, 3])], "report.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  it("returns a document of the same type", async () => {
    translate.mockResolvedValueOnce(new Blob([new Uint8Array([9])]));
    const result = await translateFile(client, {}, docx, "google", "de");
    expect(result.kind).toBe("document");
    if (result.kind !== "document") throw new Error("unexpected");
    expect(result.name).toBe("report_de.docx");
    expect(result.blob.type).toBe(docx.type);
    expect(translate.mock.calls[0][3]).toEqual({ signal: undefined });
  });

  it("asks for text when the translator cannot produce documents, and remembers it", async () => {
    translate.mockRejectedValueOnce(new HttpError("/api/v1/translate", 406, "plain text only"));
    translate.mockResolvedValueOnce("# Bericht");
    const result = await translateFile(client, {}, docx, "llm", "de");
    expect(result).toEqual({ kind: "text", text: "# Bericht", name: "report_de.md" });
    expect(translate.mock.calls[1][3]).toEqual({ signal: undefined, accept: "text/plain" });

    translate.mockClear();
    translate.mockResolvedValueOnce("# Rapport");
    await expect(translateFile(client, {}, docx, "llm", "fr")).resolves.toMatchObject({ kind: "text" });
    expect(translate).toHaveBeenCalledOnce();
    expect(translate.mock.calls[0][3]).toEqual({ signal: undefined, accept: "text/plain" });
  });

  it("keeps a text source's extension for a text result", async () => {
    translate.mockResolvedValueOnce("Hallo");
    const result = await translateFile(client, {}, new File(["Hello"], "notes.txt", { type: "text/plain" }), "", "de");
    expect(result).toMatchObject({ kind: "text", name: "notes_de.txt" });
  });

  it("surfaces other failures and size limits", async () => {
    translate.mockRejectedValueOnce(new HttpError("/api/v1/translate", 500, "boom"));
    await expect(translateFile(client, {}, docx, "google", "de")).rejects.toThrow("status 500");
    await expect(translateFile(client, { maxFileSize: 2 }, docx, "google", "de")).rejects.toThrow("over the");
  });

  it("derives result names", () => {
    expect(translatedFileName("a.b.pdf", "fr")).toBe("a.b_fr.pdf");
    expect(translatedFileName("README", "fr")).toBe("README_fr");
    expect(translatedFileName("slides.pptx", "it", ".md")).toBe("slides_it.md");
  });
});
