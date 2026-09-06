import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convertFileToText } from "./convert";

const mocks = vi.hoisted(() => ({
  extract: vi.fn(),
  builtin: vi.fn(),
  config: { extractor: { files: [".custom"] as string[], maxFileSize: undefined as number | undefined } },
}));
vi.mock("@/shared/config", () => ({ getConfig: () => ({ ...mocks.config, client: { extractText: mocks.extract } }) }));
vi.mock("./docx", () => ({ docxToMarkdown: mocks.builtin }));

beforeEach(() => {
  mocks.extract.mockReset();
  mocks.builtin.mockReset().mockResolvedValue("Built-in text");
  mocks.config.extractor.maxFileSize = undefined;
});
afterEach(() => vi.restoreAllMocks());

it("does not fall back to a built-in converter when extraction was cancelled", async () => {
  const controller = new AbortController();
  mocks.extract.mockImplementation(async (_file, options: { signal?: AbortSignal }) => {
    expect(options.signal).toBe(controller.signal);
    controller.abort();
    throw controller.signal.reason;
  });
  await expect(
    convertFileToText(new File(["source"], "notes.docx"), { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.builtin).not.toHaveBeenCalled();
});

it("retains the built-in fallback for an ordinary backend extraction failure", async () => {
  mocks.extract.mockRejectedValue(new Error("Backend unavailable"));
  expect(await convertFileToText(new File(["source"], "notes.docx"))).toBe("Built-in text");
});

it("honors a configured extractor for unknown extensions even when the browser reports no MIME type", async () => {
  mocks.extract.mockResolvedValue("Extracted custom document");
  expect(await convertFileToText(new File(["binary content"], "notes.custom"))).toBe("Extracted custom document");
});

it("rejects unsupported binary content instead of embedding decoded binary bytes", async () => {
  await expect(
    convertFileToText(new File([new Uint8Array([0, 1, 2])], "image.png", { type: "image/png" })),
  ).rejects.toThrow("No text extractor");
});

it("retains text-file support for extensionless files and text mislabelled as binary", async () => {
  expect(await convertFileToText(new File(["Plain text"], "README"))).toBe("Plain text");
  expect(await convertFileToText(new File(["Plain text"], "notes.txt", { type: "application/octet-stream" }))).toBe(
    "Plain text",
  );
  expect(mocks.extract).not.toHaveBeenCalled();
});

it("does not start work when cancelled and discards late results from a non-cancellable built-in converter", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    convertFileToText(new File(["source"], "notes.docx"), { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.extract).not.toHaveBeenCalled();

  const second = new AbortController();
  mocks.extract.mockResolvedValue("");
  mocks.builtin.mockImplementation(async () => {
    second.abort();
    return "Late text";
  });
  await expect(convertFileToText(new File(["source"], "notes.docx"), { signal: second.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
});

it("uses built-in conversion for oversized supported files but rejects oversized backend-only files", async () => {
  mocks.config.extractor.maxFileSize = 2;
  expect(await convertFileToText(new File(["source"], "notes.docx"))).toBe("Built-in text");
  await expect(
    convertFileToText(new File(["source"], "notes.custom", { type: "application/octet-stream" })),
  ).rejects.toThrow("extract limit");
  expect(mocks.extract).not.toHaveBeenCalled();
});
