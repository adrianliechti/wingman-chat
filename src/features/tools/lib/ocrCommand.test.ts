import { beforeEach, expect, it, vi } from "vitest";
import { runOcr } from "./ocrCommand";

const { extractText, extractor } = vi.hoisted(() => ({
  extractText: vi.fn(),
  extractor: { maxFileSize: undefined as number | undefined },
}));

vi.mock("@/shared/config", () => ({
  getConfig: () => ({ client: { extractText }, extractor }),
}));

beforeEach(() => {
  extractText.mockReset().mockResolvedValue("Extracted text");
  extractor.maxFileSize = undefined;
});

it("extracts documents without an enable flag or model selector", async () => {
  await expect(runOcr(new Uint8Array([1]), "/report.pdf")).resolves.toBe("Extracted text");
  const [file] = extractText.mock.calls[0];
  expect(file.name).toBe("report.pdf");
  expect(file.type).toBe("application/pdf");
});

it.each([0, 1])("enforces the extractor upload limit of %i bytes", async (limit) => {
  extractor.maxFileSize = limit;
  await expect(runOcr(new Uint8Array([1, 2]), "/report.pdf")).rejects.toThrow("configured size limit");
  expect(extractText).not.toHaveBeenCalled();
});
