import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioRecorder } from "./AudioRecorder";
import { deferred, FakeContext, FakeWorklet, fakeStream, installAudioFakes } from "./audioTestSupport";

let audio: ReturnType<typeof installAudioFakes>;
beforeEach(() => {
  audio = installAudioFakes();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("microphone ownership", () => {
  it("stops a stream granted after end without initializing an audio context", async () => {
    const permission = deferred<ReturnType<typeof fakeStream>>();
    audio.getUserMedia.mockReturnValueOnce(permission.promise);
    const recorder = new AudioRecorder();
    const starting = recorder.begin();
    const result = starting.catch((error: unknown) => error);
    await recorder.end();
    permission.resolve(audio.stream);
    await result;
    expect(audio.stream.track.stop).toHaveBeenCalledTimes(1);
    expect(FakeContext.instances).toHaveLength(0);
  });

  it("stops an ended input before creating a graph", async () => {
    audio.stream.track.end();
    await expect(new AudioRecorder().begin()).rejects.toThrow("microphone is disconnected");
    expect(audio.stream.track.stop).toHaveBeenCalled();
    expect(FakeContext.instances).toHaveLength(0);
  });

  it("coalesces repeated begin calls and isolates a restart from late permission", async () => {
    const permission = deferred<ReturnType<typeof fakeStream>>();
    audio.getUserMedia.mockReturnValueOnce(permission.promise);
    const recorder = new AudioRecorder();
    const first = recorder.begin().catch(() => {});
    const duplicate = recorder.begin().catch(() => {});
    expect(audio.getUserMedia).toHaveBeenCalledTimes(1);
    await recorder.end();
    const replacement = fakeStream();
    audio.getUserMedia.mockResolvedValueOnce(replacement);
    await recorder.begin();
    permission.resolve(audio.stream);
    await Promise.all([first, duplicate]);
    expect(replacement.track.stop).not.toHaveBeenCalled();
    expect(audio.stream.track.stop).toHaveBeenCalledTimes(1);
    await recorder.record(vi.fn());
    await recorder.end();
    expect(replacement.track.stop).toHaveBeenCalledTimes(1);
  });

  it.each(["resume", "addModule"] as const)("cleans a failure in %s and can retry", async (stage) => {
    FakeContext[stage].mockRejectedValueOnce(new Error("setup failed"));
    const recorder = new AudioRecorder();
    await expect(recorder.begin()).rejects.toThrow("setup failed");
    expect(audio.stream.track.stop).toHaveBeenCalledTimes(1);
    expect(FakeContext.instances[0].close).toHaveBeenCalledTimes(1);
    audio.getUserMedia.mockResolvedValueOnce(fakeStream());
    await recorder.begin();
    await recorder.end();
  });

  it("releases every resource even if disconnect and context.close fail", async () => {
    const recorder = new AudioRecorder();
    await recorder.begin();
    const node = FakeWorklet.instances[0];
    node.disconnect.mockImplementationOnce(() => {
      throw new Error("disconnected");
    });
    FakeContext.close.mockRejectedValueOnce(new Error("already closed"));
    await recorder.end().catch(() => {});
    expect(audio.stream.track.stop).toHaveBeenCalledTimes(1);
    expect(FakeContext.instances[0].close).toHaveBeenCalledTimes(1);
    expect(node.port.onmessage).toBeNull();
    expect(node.port.close).toHaveBeenCalledTimes(1);
    await recorder.end();
  });

  it("cannot build a worklet after ending during module loading", async () => {
    const module = deferred();
    FakeContext.addModule.mockReturnValueOnce(module.promise);
    const recorder = new AudioRecorder();
    const starting = recorder.begin().catch(() => {});
    await vi.waitFor(() => expect(FakeContext.addModule).toHaveBeenCalled());
    await recorder.end();
    module.resolve();
    await starting;
    expect(FakeWorklet.instances).toHaveLength(0);
    expect(audio.revoke).toHaveBeenCalledTimes(1);
    expect(audio.stream.track.stop).toHaveBeenCalledTimes(1);
  });

  it("ignores chunks after pause and end", async () => {
    const recorder = new AudioRecorder();
    await recorder.begin();
    const callback = vi.fn();
    await recorder.record(callback);
    const node = FakeWorklet.instances[0];
    const chunk = { event: "chunk", recordingId: 1, mono: new Int16Array([1]).buffer };
    node.receive(chunk);
    await recorder.pause();
    node.receive(chunk);
    await recorder.end();
    node.receive(chunk);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
