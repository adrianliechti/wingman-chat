import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Translation } from "../types/translate";
import { abortJob, type JobRuntime, refineJob, runFileJob, runTextJob } from "./translationJobs";

vi.mock("./translationStorage", () => ({
  readTranslationFile: vi.fn(async (_id: string, which: string) =>
    which === "source" ? new File(["bytes"], "report.docx", { type: "application/x-docx" }) : undefined,
  ),
  writeTranslationFile: vi.fn(async () => {}),
  removeTranslationFile: vi.fn(async () => {}),
}));

const translate = vi.fn<(...args: any[]) => Promise<string | Blob>>();
const rewriteText = vi.fn<(...args: any[]) => Promise<string>>();

function textJob(overrides: Partial<Translation> = {}): Translation {
  return {
    id: "t",
    kind: "text",
    created: new Date(0),
    updated: new Date(0),
    provider: "llm",
    targetLang: "de",
    formality: "",
    style: "",
    sourceText: "Hello",
    status: "idle",
    ...overrides,
  };
}

function runtimeFor(initial: Translation) {
  let job: Translation | undefined = initial;
  const runtime: JobRuntime = {
    client: { translate, rewriteText },
    options: { model: "writer" },
    get: () => job,
    patch: (_id, updater) => {
      if (job) job = updater(job);
    },
    controllers: new Map(),
  };
  return { runtime, current: () => job };
}

beforeEach(() => {
  translate.mockReset().mockResolvedValue("Hallo");
  rewriteText.mockReset().mockResolvedValue("Hallo!");
});

describe("text jobs", () => {
  it("translates, records the request fingerprint and finishes done", async () => {
    const { runtime, current } = runtimeFor(textJob());
    await runTextJob(runtime, "t");
    expect(current()).toMatchObject({ status: "done", translatedText: "Hallo", resultText: "Hallo" });
    expect(current()?.translatedKey).toBeTruthy();
    expect(rewriteText).not.toHaveBeenCalled();
    expect(runtime.controllers.size).toBe(0);
  });

  it("only rewrites when the formality changed since the translation", async () => {
    const { runtime, current } = runtimeFor(textJob());
    await runTextJob(runtime, "t");
    runtime.patch("t", (job) => ({ ...job, formality: "formal" }));
    await runTextJob(runtime, "t");
    expect(translate).toHaveBeenCalledOnce();
    expect(rewriteText).toHaveBeenCalledWith(
      "writer",
      "Hallo",
      { lang: "de", formality: "formal", style: "", source: "Hello" },
      expect.anything(),
    );
    expect(current()?.resultText).toBe("Hallo!");
  });

  it("ignores a superseded run and keeps the newer one's result", async () => {
    let releaseFirst!: (value: string) => void;
    translate.mockReturnValueOnce(new Promise<string>((resolve) => (releaseFirst = resolve)));
    translate.mockResolvedValueOnce("Servus");
    const { runtime, current } = runtimeFor(textJob());
    const first = runTextJob(runtime, "t");
    runtime.patch("t", (job) => ({ ...job, sourceText: "Hi" }));
    const second = runTextJob(runtime, "t");
    releaseFirst("stale");
    await Promise.all([first, second]);
    expect(current()).toMatchObject({ status: "done", resultText: "Servus" });
  });

  it("reports failures and stays quiet after a cancel", async () => {
    translate.mockRejectedValueOnce(new Error("boom"));
    const { runtime, current } = runtimeFor(textJob());
    await runTextJob(runtime, "t");
    expect(current()).toMatchObject({ status: "error", error: "boom" });

    translate.mockReturnValueOnce(new Promise<string>(() => {}));
    const pending = runTextJob(runtime, "t");
    abortJob(runtime, "t");
    runtime.patch("t", (job) => ({ ...job, status: "idle", error: undefined }));
    await Promise.race([pending, Promise.resolve()]);
    expect(current()?.status).toBe("idle");
  });

  it("refines the result and replaces it", async () => {
    const { runtime, current } = runtimeFor(textJob({ resultText: "Hallo", status: "done" }));
    rewriteText.mockResolvedValueOnce("Grüezi");
    await refineJob(runtime, "t", "Swiss");
    expect(rewriteText).toHaveBeenCalledWith(
      "writer",
      "Hallo",
      { lang: "de", instruction: "Swiss", source: "Hello" },
      expect.anything(),
    );
    expect(current()?.resultText).toBe("Grüezi");
  });
});

describe("file jobs", () => {
  const fileJob = textJob({
    id: "f",
    kind: "file",
    sourceText: "",
    sourceFile: { name: "report.docx", contentType: "application/x-docx", size: 5 },
  });

  it("stores a translated document", async () => {
    translate.mockResolvedValueOnce(new Blob([new Uint8Array([1, 2])], { type: "application/x-docx" }));
    const { runtime, current } = runtimeFor(fileJob);
    await runFileJob(runtime, "f");
    expect(current()).toMatchObject({
      status: "done",
      resultFile: { name: "report_de.docx", contentType: "application/x-docx", size: 2 },
      resultText: undefined,
    });
  });

  it("keeps a text result as markdown beside the original", async () => {
    translate.mockResolvedValueOnce("# Bericht");
    const { runtime, current } = runtimeFor(fileJob);
    await runFileJob(runtime, "f");
    expect(current()).toMatchObject({
      status: "done",
      resultText: "# Bericht",
      resultFile: { name: "report_de.md", contentType: "text/markdown" },
    });
  });
});
