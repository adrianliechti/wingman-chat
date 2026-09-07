import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTranscription } from "./useTranscription";
import { AudioRecorder } from "../lib/AudioRecorder";
import { deferred, fakeStream, FakeContext, FakeWorklet, installAudioFakes } from "../lib/audioTestSupport";

const transcribe = vi.hoisted(() =>
  vi.fn(async (_model: string, _blob: Blob, _options: { signal: AbortSignal }) => "Transcript"),
);
vi.mock("@/shared/config", () => ({ getConfig: () => ({ stt: { model: "stt" }, client: { transcribe } }) }));
vi.mock("@/shell/hooks/useAudioDevices", () => ({ useAudioDevices: () => ({ inputDeviceId: "chosen" }) }));
let audio: ReturnType<typeof installAudioFakes>;
beforeEach(() => {
  audio = installAudioFakes();
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
  vi.spyOn(AudioRecorder.prototype, "record").mockRejectedValueOnce(new Error("Port closed"));
  await expect(hook.startTranscription()).rejects.toThrow("Port closed");
  expect(audio.stream.track.stop).toHaveBeenCalledTimes(1);
  expect(FakeContext.instances[0].close).toHaveBeenCalledTimes(1);
  audio.getUserMedia.mockResolvedValueOnce(fakeStream());
  await hook.startTranscription();
  await expect(hook.stopTranscription()).rejects.toThrow("No audio recorded");
});

it("shares duplicate stops, freezes its WAV and releases the mic before upload", async () => {
  const hook = harness();
  await hook.startTranscription();
  expect(audio.getUserMedia.mock.calls[0][0].audio).toMatchObject({ deviceId: { exact: "chosen" }, sampleRate: 24000 });
  const node = FakeWorklet.instances[0];
  const chunk = (samples: number[]) =>
    node.receive({ event: "chunk", recordingId: 1, mono: new Int16Array(samples).buffer });
  chunk([100, -200]);
  const response = deferred<string>();
  transcribe.mockReturnValueOnce(response.promise);
  const first = hook.stopTranscription();
  const duplicate = hook.stopTranscription();
  expect(duplicate).toBe(first);
  chunk([300]);
  await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
  expect(audio.stream.track.stop).toHaveBeenCalledTimes(1);
  const [model, blob, options] = transcribe.mock.calls[0];
  expect(model).toBe("stt");
  expect(options.signal.aborted).toBe(false);
  expect(Array.from(new Int16Array((await blob.arrayBuffer()).slice(44)))).toEqual([100, -200]);
  response.resolve("Transcript");
  expect(await first).toBe("Transcript");
  expect(await duplicate).toBe("Transcript");
});

it("clears failed STT uploads so another recording can start", async () => {
  const hook = harness();
  await hook.startTranscription();
  FakeWorklet.instances[0].receive({ event: "chunk", recordingId: 1, mono: new Int16Array([1]).buffer });
  transcribe.mockRejectedValueOnce(new Error("STT unavailable"));
  await expect(hook.stopTranscription()).rejects.toThrow("STT unavailable");
  const next = fakeStream();
  audio.getUserMedia.mockResolvedValueOnce(next);
  await hook.startTranscription();
  expect(next.track.stop).not.toHaveBeenCalled();
  await expect(hook.stopTranscription()).rejects.toThrow("No audio recorded");
  expect(next.track.stop).toHaveBeenCalled();
});
