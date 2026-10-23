import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTranscription } from "./useTranscription";
import { deferred, fakeStream, FakeContext, installAudioFakes } from "../lib/audioTestSupport";

// Fake only the browser device/encoder; exercise TanStack's real recorder.
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;
  mimeType = "audio/webm;codecs=opus";
  blob = new Blob();
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: { error: Error }) => void) | null = null;
  constructor() {
    FakeMediaRecorder.instances.push(this);
  }
  start() {}
  stop() {
    this.ondataavailable?.({ data: this.blob });
    this.onstop?.();
  }
}

const transcribe = vi.hoisted(() =>
  vi.fn(async (_model: string, _blob: Blob, _options: { signal: AbortSignal }) => "Transcript"),
);
vi.mock("@/shared/config", () => ({ getConfig: () => ({ stt: { model: "stt" }, client: { transcribe } }) }));
vi.mock("@/shell/hooks/useAudioDevices", () => ({ useAudioDevices: () => ({ inputDeviceId: "chosen" }) }));
let audio: ReturnType<typeof installAudioFakes>;
beforeEach(() => {
  audio = installAudioFakes();
  FakeMediaRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  transcribe.mockReset().mockResolvedValue("Transcript");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function harness() {
  let hook!: ReturnType<typeof useTranscription>;
  function Harness() {
    hook = useTranscription();
    return null;
  }
  renderToString(<Harness />);
  return hook;
}

it("coalesces starts during permission and cancels without uploading", async () => {
  const permission = deferred<ReturnType<typeof fakeStream>>();
  audio.getUserMedia.mockReturnValueOnce(permission.promise);
  const hook = harness();
  const starting = hook.startTranscription();
  await hook.startTranscription();
  expect(audio.getUserMedia).toHaveBeenCalledTimes(1);
  expect(await hook.stopTranscription()).toBe("");
  await starting;
  permission.resolve(audio.stream);
  await vi.waitFor(() => expect(audio.stream.track.stop).toHaveBeenCalled());
  expect(FakeContext.instances).toHaveLength(0);
  expect(transcribe).not.toHaveBeenCalled();
});

it("surfaces permission and record failures, releases resources, and permits retry", async () => {
  const hook = harness();
  audio.getUserMedia.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
  await expect(hook.startTranscription()).rejects.toThrow("Permission denied");
  vi.spyOn(FakeMediaRecorder.prototype, "start").mockImplementationOnce(() => {
    throw new Error("Encoder failed");
  });
  await expect(hook.startTranscription()).rejects.toThrow("Encoder failed");
  expect(audio.stream.track.stop).toHaveBeenCalledTimes(1);
  expect(FakeContext.instances).toHaveLength(0);
  audio.getUserMedia.mockResolvedValueOnce(fakeStream());
  await hook.startTranscription();
  await expect(hook.stopTranscription()).rejects.toThrow("No audio recorded");
});

it("shares duplicate stops, forwards native encoded audio and releases the mic before upload", async () => {
  const hook = harness();
  await hook.startTranscription();
  expect(audio.getUserMedia.mock.calls[0][0].audio).toMatchObject({ deviceId: { exact: "chosen" }, channelCount: 1 });
  FakeMediaRecorder.instances[0].blob = new Blob([new Uint8Array([10, 20, 30])]);
  const response = deferred<string>();
  transcribe.mockReturnValueOnce(response.promise);
  const first = hook.stopTranscription();
  const duplicate = hook.stopTranscription();
  expect(duplicate).toBe(first);
  await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
  expect(audio.stream.track.stop).toHaveBeenCalledTimes(1);
  const [model, blob, options] = transcribe.mock.calls[0];
  expect(model).toBe("stt");
  expect(options.signal.aborted).toBe(false);
  expect(blob.type).toBe("audio/webm;codecs=opus");
  expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([10, 20, 30]);
  expect(FakeContext.instances).toHaveLength(0);
  response.resolve("Transcript");
  expect(await first).toBe("Transcript");
  expect(await duplicate).toBe("Transcript");
});

it("clears failed STT uploads so another recording can start", async () => {
  const hook = harness();
  await hook.startTranscription();
  FakeMediaRecorder.instances[0].blob = new Blob(["audio"]);
  transcribe.mockRejectedValueOnce(new Error("STT unavailable"));
  await expect(hook.stopTranscription()).rejects.toThrow("STT unavailable");
  const next = fakeStream();
  audio.getUserMedia.mockResolvedValueOnce(next);
  await hook.startTranscription();
  expect(next.track.stop).not.toHaveBeenCalled();
  await expect(hook.stopTranscription()).rejects.toThrow("No audio recorded");
  expect(next.track.stop).toHaveBeenCalled();
});

it("allows a new dictation after the device ends a recording itself", async () => {
  const hook = harness();
  await hook.startTranscription();
  FakeMediaRecorder.instances[0].stop();
  await vi.waitFor(() => expect(audio.stream.track.stop).toHaveBeenCalledOnce());
  const next = fakeStream();
  audio.getUserMedia.mockResolvedValueOnce(next);
  await hook.startTranscription();
  expect(FakeMediaRecorder.instances).toHaveLength(2);
  expect(next.track.stop).not.toHaveBeenCalled();
  await expect(hook.stopTranscription()).rejects.toThrow("No audio recorded");
});

it("hides dictation when the browser has no native media recorder", () => {
  vi.stubGlobal("MediaRecorder", undefined);
  expect(harness().canTranscribe).toBe(false);
});
