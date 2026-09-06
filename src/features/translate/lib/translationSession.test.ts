import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFromUrl } from "@/shared/lib/utils";
import { TranslationSession } from "./translationSession";

vi.mock("@/shared/lib/utils", () => ({ downloadFromUrl: vi.fn(), formatBytes: (size: number) => `${size} bytes` }));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const translate =
  vi.fn<(...args: Parameters<import("@/shared/lib/client").Client["translate"]>) => Promise<string | Blob>>();
const rewriteText = vi.fn<import("@/shared/lib/client").Client["rewriteText"]>(async () => "rewritten");
const createUrl = vi.fn(() => "blob:download");
const revokeUrl = vi.fn();
let session: TranslationSession;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  translate.mockReset().mockResolvedValue("translated");
  rewriteText.mockReset().mockResolvedValue("rewritten");
  vi.spyOn(URL, "createObjectURL").mockImplementation(createUrl);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeUrl);
  session = new TranslationSession({ translate, rewriteText });
});
afterEach(() => {
  session.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("translation ownership", () => {
  it("debounces the complete input and coalesces a manual request with its scheduled translation", async () => {
    session.update({ sourceText: "Hello" });
    session.update({ targetLang: "de", tone: "friendly" });
    const pending = session.translate();
    expect(session.translate()).toBe(pending);
    await pending;
    await vi.advanceTimersByTimeAsync(2000);
    expect(translate).toHaveBeenCalledOnce();
    expect(translate.mock.calls[0].slice(0, 2)).toEqual(["de", "Hello"]);
    expect(rewriteText).toHaveBeenCalledOnce();
    expect(session.getSnapshot().translatedText).toBe("rewritten");
  });

  it("aborts replaced input and ignores an older success and finally while a newer request is running", async () => {
    const old = deferred<string>();
    const latest = deferred<string>();
    translate.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    session.update({ sourceText: "Old" });
    const first = session.translate();
    await Promise.resolve();
    const signal = translate.mock.calls[0][2]?.signal;
    session.update({ targetLang: "fr" });
    const second = session.translate();
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    old.resolve("stale");
    await first;
    expect(session.getSnapshot()).toMatchObject({ translatedText: "", isLoading: true, error: null });
    latest.resolve("Bonjour");
    await second;
    expect(session.getSnapshot()).toMatchObject({ translatedText: "Bonjour", isLoading: false });
  });

  it("reset cancels rewriting and a late failure cannot restore an error", async () => {
    const rewrite = deferred<string>();
    rewriteText.mockReturnValueOnce(rewrite.promise);
    session.update({ sourceText: "Hello", style: "business" });
    const pending = session.translate();
    await vi.advanceTimersByTimeAsync(0);
    expect(rewriteText).toHaveBeenCalledOnce();
    const signal = translate.mock.calls[0][2]?.signal;
    session.reset();
    expect(signal?.aborted).toBe(true);
    rewrite.reject(new Error("late failure"));
    await pending;
    expect(session.getSnapshot()).toMatchObject({ sourceText: "", translatedText: "", isLoading: false, error: null });
  });

  it("does not download a file whose selection was cleared before completion", async () => {
    const file = deferred<Blob>();
    translate.mockReturnValueOnce(file.promise);
    session.update({ selectedFile: new File(["input"], "test.pdf") });
    const pending = session.translate();
    await Promise.resolve();
    session.update({ selectedFile: null });
    file.resolve(new Blob(["stale"]));
    await pending;
    expect(createUrl).not.toHaveBeenCalled();
    expect(downloadFromUrl).not.toHaveBeenCalled();
  });

  it("releases downloads on replacement, reset, and unmount", async () => {
    translate.mockResolvedValue(new Blob(["translated"]));
    session.update({ selectedFile: new File(["input"], "test.pdf") });
    await session.translate();
    expect(downloadFromUrl).toHaveBeenCalledWith("blob:download", "test_en.pdf");
    session.update({ targetLang: "de" });
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    await session.translate();
    session.reset();
    expect(revokeUrl).toHaveBeenCalledTimes(2);
    session.update({ selectedFile: new File(["input"], "test.pdf") });
    await session.translate();
    session.dispose();
    expect(revokeUrl).toHaveBeenCalledTimes(3);
  });

  it("unmount cancels a pending debounce and blocks late results", async () => {
    session.update({ sourceText: "pending" });
    session.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(translate).not.toHaveBeenCalled();
  });

  it("validates file and text limits before sending", async () => {
    session.dispose();
    session = new TranslationSession({ translate, rewriteText }, { maxTextLength: 3, maxFileSize: 2 });
    session.update({ sourceText: "long" });
    await session.translate();
    expect(session.getSnapshot().error).toContain("characters");
    session.update({ selectedFile: new File(["long"], "test.txt") });
    await session.translate();
    expect(session.getSnapshot().error).toContain("bytes");
    expect(translate).not.toHaveBeenCalled();
  });
  it("ignores a successful rewrite that finishes after newer input has completed", async () => {
    const old = deferred<string>();
    rewriteText.mockReturnValueOnce(old.promise);
    session.update({ sourceText: "old", tone: "formal" });
    const previous = session.translate();
    await vi.advanceTimersByTimeAsync(0);
    session.update({ sourceText: "new", tone: "" });
    await session.translate();
    old.resolve("obsolete rewrite");
    await previous;
    expect(session.getSnapshot()).toMatchObject({ sourceText: "new", translatedText: "translated", isLoading: false });
  });

  it("allows resetting synchronously when loading starts without sending the cancelled request", async () => {
    session.update({ sourceText: "cancel immediately" });
    const unsubscribe = session.subscribe(() => {
      if (session.getSnapshot().isLoading) session.reset();
    });
    await session.translate();
    unsubscribe();
    expect(translate).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ sourceText: "", translatedText: "", isLoading: false });
  });

  it("does not download a result released by a subscriber during publication", async () => {
    translate.mockResolvedValue(new Blob(["result"]));
    session.update({ selectedFile: new File(["input"], "test.pdf") });
    const unsubscribe = session.subscribe(() => {
      if (session.getSnapshot().translatedFileUrl) session.reset();
    });
    await session.translate();
    unsubscribe();
    expect(revokeUrl).toHaveBeenCalledOnce();
    expect(downloadFromUrl).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ selectedFile: null, translatedFileUrl: null });
  });

  it("retries a failed request with unchanged input", async () => {
    translate.mockRejectedValueOnce(new Error("temporary"));
    session.update({ sourceText: "retry" });
    await session.translate();
    expect(session.getSnapshot().error).toBe("temporary");
    await session.translate();
    expect(translate).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot()).toMatchObject({ translatedText: "translated", error: null });
  });
});
