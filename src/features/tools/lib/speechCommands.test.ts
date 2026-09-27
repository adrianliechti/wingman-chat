import { beforeEach, expect, it, vi } from "vitest";
import { runSynthesize } from "./synthesizeCommand";
import { runTranscribe } from "./transcribeCommand";
import { deferred } from "@/features/voice/lib/audioTestSupport";
import type { Model } from "@/shared/types/chat";

const mocks = vi.hoisted(() => ({
  models: { tts: "tts" as string | undefined, stt: "stt" as string | undefined },
  speechConfig: true,
  listModels: vi.fn<() => Promise<Model[]>>(),
  synthesize: vi.fn(async () => new Blob(["wav"])),
  transcribe: vi.fn(async () => "Transcript"),
  extract: vi.fn(async () => new Blob(["extracted"], { type: "audio/ogg" })),
}));
vi.mock("@/shared/config", () => ({
  getConfig: () => ({
    tts: mocks.speechConfig ? { model: mocks.models.tts, voices: { narrator: "voice-id" } } : undefined,
    stt: mocks.speechConfig ? { model: mocks.models.stt, format: "opus" } : undefined,
    models: [],
    client: { generateAudio: mocks.synthesize, transcribe: mocks.transcribe, listModels: mocks.listModels },
  }),
}));
vi.mock("./extractAudio", () => ({ extractAudioForTranscription: mocks.extract }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.models = { tts: "tts", stt: "stt" };
  mocks.speechConfig = true;
  mocks.listModels.mockReset().mockResolvedValue([
    { id: "discovered-tts", name: "Speaker", type: "synthesizer" },
    { id: "discovered-stt", name: "Dictation", type: "transcriber" },
  ]);
});

it("resolves a configured speaker and forwards cancellation to synthesis", async () => {
  const controller = new AbortController();
  expect(new TextDecoder().decode(await runSynthesize("Hello", "narrator", { signal: controller.signal }))).toBe("wav");
  expect(mocks.synthesize).toHaveBeenCalledWith("tts", "Hello", "voice-id", { signal: controller.signal });
});

it("preserves audio bytes and strips video through cancellable extraction", async () => {
  const controller = new AbortController();
  const bytes = new Uint8Array([1, 2, 3]);
  expect(await runTranscribe(bytes, "/memo.wav", { signal: controller.signal })).toBe("Transcript");
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(mocks.transcribe).toHaveBeenCalledWith("stt", expect.objectContaining({ type: "audio/wav", size: 3 }), {
    signal: controller.signal,
  });
  expect(await runTranscribe(bytes, "/recording.mp4", { signal: controller.signal })).toBe("Transcript");
  expect(mocks.extract).toHaveBeenCalledWith(bytes, "video/mp4", "opus", controller.signal);
  expect(mocks.transcribe).toHaveBeenLastCalledWith("stt", expect.objectContaining({ type: "audio/ogg" }), {
    signal: controller.signal,
  });
});

it("uses catalog models without speech config", async () => {
  mocks.speechConfig = false;
  await runSynthesize("Hello");
  await runTranscribe(new Uint8Array([1]), "/memo.wav");
  expect(mocks.synthesize).toHaveBeenCalledWith("discovered-tts", "Hello", undefined, {});
  expect(mocks.transcribe).toHaveBeenCalledWith("discovered-stt", expect.any(Blob), {});
});

it("does not dispatch speech requests when the catalog has no matching models", async () => {
  mocks.models = { tts: undefined, stt: undefined };
  mocks.listModels.mockResolvedValue([{ id: "gpt-live-transcribe", name: "Live", type: "realtime" }]);
  await expect(runSynthesize("Hello")).rejects.toThrow("no speech synthesis model available");
  await expect(runTranscribe(new Uint8Array([1]), "/memo.wav")).rejects.toThrow("no transcription model available");
  expect(mocks.synthesize).not.toHaveBeenCalled();
  expect(mocks.transcribe).not.toHaveBeenCalled();
});

it("does not upload a file whose extraction finishes after cancellation", async () => {
  const controller = new AbortController();
  const extraction = deferred<Blob>();
  mocks.extract.mockReturnValueOnce(extraction.promise);
  const request = runTranscribe(new Uint8Array([1]), "/memo.mp4", { signal: controller.signal });
  const result = request.catch((error: unknown) => error);
  controller.abort();
  extraction.resolve(new Blob(["audio"]));
  expect(await result).toMatchObject({ name: "AbortError" });
  expect(mocks.transcribe).not.toHaveBeenCalled();
});

it("rejects invalid helper input without dispatching requests", async () => {
  await expect(runSynthesize(" ")).rejects.toThrow("no text");
  await expect(runTranscribe(new Uint8Array(), "/memo.wav")).rejects.toThrow("empty");
  await expect(runTranscribe(new Uint8Array([1]), "/memo.txt")).rejects.toThrow("not an audio file");
  expect(mocks.synthesize).not.toHaveBeenCalled();
  expect(mocks.transcribe).not.toHaveBeenCalled();
});
