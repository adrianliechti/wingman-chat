import { describe, expect, it, vi } from "vitest";
import { createBashCommands, type BashServices } from "./bashCommands";
import { runBash } from "./bashRuntime";

function services() {
  return {
    ocr: vi.fn<BashServices["ocr"]>(async () => "Grüezi 🪽\nextracted text"),
    llm: vi.fn<BashServices["llm"]>(async () => "Résumé 🪽"),
  };
}

describe("Bash service commands", () => {
  it("reads bytes from the current VFS, pipes Unicode to llm and writes both output forms", async () => {
    const bridge = services();
    const result = await runBash(
      {
        code: 'mkdir reports; cd reports; extract ../input.pdf | llm -m specialist -s "Summarize" -e low > summary.md; ocr -o nested/raw.txt ../input.pdf',
        files: { "/input.pdf": { content: "data:application/pdf;base64,AP+AQg==", contentType: "application/pdf" } },
      },
      undefined,
      createBashCommands(bridge),
    );
    expect(result.success, result.error).toBe(true);
    expect(bridge.ocr).toHaveBeenCalledTimes(2);
    expect([...bridge.ocr.mock.calls[0][0]]).toEqual([0, 255, 128, 66]);
    expect(bridge.ocr.mock.calls[0][1]).toBe("/home/user/input.pdf");
    expect(bridge.llm).toHaveBeenCalledWith(
      "Grüezi 🪽\nextracted text\n",
      { model: "specialist", system: "Summarize", effort: "low" },
      undefined,
    );
    expect(result.files?.["/reports/summary.md"].content).toBe("Résumé 🪽\n");
    expect(result.files?.["/reports/nested/raw.txt"].content).toBe("Grüezi 🪽\nextracted text");
  });

  it("includes prompt arguments and stdin together and accepts literal arguments after --", async () => {
    const bridge = services();
    const result = await runBash(
      { code: 'printf "input 🪽" | llm -o result.txt -- "--summarize"' },
      undefined,
      createBashCommands(bridge),
    );
    expect(result.success, result.error).toBe(true);
    expect(bridge.llm.mock.calls[0][0]).toBe("--summarize\n\ninput 🪽");
    expect(result.files?.["/result.txt"].content).toBe("Résumé 🪽");
  });

  it("rejects malformed invocations and missing inputs before calling services", async () => {
    const bridge = services();
    for (const code of [
      "llm --effort invalid prompt",
      "llm -m",
      "llm --unknown prompt",
      "llm",
      "ocr",
      "extract missing.pdf",
      "extract one.pdf two.pdf",
    ]) {
      const result = await runBash({ code }, undefined, createBashCommands(bridge));
      expect(result.success, code).toBe(false);
      expect(result.error).toBeTruthy();
    }
    expect(bridge.llm).not.toHaveBeenCalled();
    expect(bridge.ocr).not.toHaveBeenCalled();
  });

  it("returns service errors without a committable snapshot", async () => {
    const bridge = services();
    bridge.llm.mockRejectedValueOnce(new Error("upstream unavailable"));
    const result = await runBash(
      { code: "echo partial > partial.txt; llm prompt > failed.txt" },
      undefined,
      createBashCommands(bridge),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("upstream unavailable");
    expect(result.files).toBeUndefined();
  });
});
