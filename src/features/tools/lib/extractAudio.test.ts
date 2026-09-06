import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { extractAudioForTranscription } from "./extractAudio";
import { deferred } from "@/features/voice/lib/audioTestSupport";

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  outputCancel: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  execute: vi.fn(async () => {}),
  init: vi.fn(),
  canEncode: vi.fn(async () => true),
}));
vi.mock("mediabunny", () => ({
  Input: class {
    dispose = mocks.dispose;
  },
  Output: class {
    target = { buffer: new Uint8Array([1, 2]).buffer };
    cancel = mocks.outputCancel;
  },
  Conversion: { init: mocks.init },
  ALL_FORMATS: [],
  BlobSource: class {},
  BufferTarget: class {},
  OggOutputFormat: class {},
  WebMOutputFormat: class {},
  Mp4OutputFormat: class {},
  WavOutputFormat: class {},
  canEncodeAudio: mocks.canEncode,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockReset().mockResolvedValue();
  mocks.init
    .mockReset()
    .mockImplementation(async () => ({ isValid: true, execute: mocks.execute, cancel: mocks.cancel }));
  mocks.canEncode.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

it("disposes the decoder on success and falls back to WAV when the requested encoder is unavailable", async () => {
  mocks.canEncode.mockResolvedValueOnce(false);
  expect((await extractAudioForTranscription(new Uint8Array([1]), "video/webm", "mp4")).type).toBe("audio/wav");
  expect(mocks.dispose).toHaveBeenCalledTimes(1);
  expect(mocks.init.mock.calls[0][0]).toMatchObject({
    video: { discard: true },
    audio: { numberOfChannels: 1, sampleRate: 16000 },
  });
});

it.each(["init", "execute"] as const)("releases the decoder/output after %s fails", async (stage) => {
  mocks[stage].mockRejectedValueOnce(new Error("Bad audio"));
  await expect(extractAudioForTranscription(new Uint8Array([1]), "video/webm")).rejects.toThrow("Bad audio");
  expect(mocks.dispose).toHaveBeenCalledTimes(1);
  expect(mocks.outputCancel).toHaveBeenCalledTimes(1);
});

it("cancels an active conversion promptly and disposes its input", async () => {
  const execution = deferred();
  mocks.execute.mockReturnValueOnce(execution.promise);
  const controller = new AbortController();
  const extraction = extractAudioForTranscription(new Uint8Array([1]), "video/webm", "opus", controller.signal);
  const result = extraction.catch((error: unknown) => error);
  await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalled());
  controller.abort();
  expect(await result).toMatchObject({ name: "AbortError" });
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
  expect(mocks.dispose).toHaveBeenCalledTimes(1);
  execution.resolve();
});

it("cleans up a conversion initialized after cancellation without executing it", async () => {
  const initializing = deferred<object>();
  mocks.init.mockReturnValueOnce(initializing.promise);
  const controller = new AbortController();
  const extraction = extractAudioForTranscription(new Uint8Array([1]), "video/webm", "opus", controller.signal);
  const result = extraction.catch((error: unknown) => error);
  await vi.waitFor(() => expect(mocks.init).toHaveBeenCalled());
  controller.abort();
  expect(await result).toMatchObject({ name: "AbortError" });
  initializing.resolve({ isValid: true, execute: mocks.execute, cancel: mocks.cancel });
  await vi.waitFor(() => expect(mocks.cancel).toHaveBeenCalled());
  expect(mocks.execute).not.toHaveBeenCalled();
});
