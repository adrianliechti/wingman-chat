import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioStreamPlayer } from "./AudioStreamPlayer";
import { deferred, FakeAudio, FakeContext, FakeWorklet, installAudioFakes } from "./audioTestSupport";

let audio: ReturnType<typeof installAudioFakes>;
beforeEach(() => {
  audio = installAudioFakes();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("streaming playback ownership", () => {
  it.each(["resume", "addModule"] as const)("rolls back a failed %s", async (stage) => {
    FakeContext[stage].mockRejectedValueOnce(new Error("setup failed"));
    const player = new AudioStreamPlayer();
    await expect(player.connect()).rejects.toThrow("setup failed");
    expect(FakeContext.instances[0].close).toHaveBeenCalledTimes(1);
    await player.disconnect();
  });

  it("coalesces connect calls", async () => {
    const player = new AudioStreamPlayer();
    await Promise.all([player.connect(), player.connect()]);
    expect(FakeContext.instances).toHaveLength(1);
    await player.disconnect();
  });

  it("cancels suspended setup and keeps a reconnect independent of late completion", async () => {
    const resume = deferred();
    FakeContext.resume.mockReturnValueOnce(resume.promise);
    const player = new AudioStreamPlayer();
    const connecting = player.connect().catch((error: unknown) => error);
    await player.disconnect();
    expect(await connecting).toMatchObject({ name: "AbortError" });
    await player.connect();
    resume.resolve();
    await Promise.resolve();
    player.add16BitPCM(new Int16Array([1]), "new");
    expect(FakeWorklet.instances).toHaveLength(1);
    expect(FakeWorklet.instances[0].port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ event: "write", trackId: "new" }),
    );
    expect(FakeContext.instances[1].close).not.toHaveBeenCalled();
    await player.disconnect();
  });

  it("fails a disconnected output without silently playing through another device", async () => {
    FakeAudio.setSinkId.mockRejectedValueOnce(new DOMException("Device missing", "NotFoundError"));
    const player = new AudioStreamPlayer({ sinkId: "removed" });
    await expect(player.connect()).rejects.toThrow("Device missing");
    expect(FakeAudio.play).not.toHaveBeenCalled();
    expect(FakeContext.instances[0].output.stream.track.stop).toHaveBeenCalled();
    expect(FakeContext.instances[0].close).toHaveBeenCalled();
  });

  it("settles an interrupt if posting to the processor fails", async () => {
    const onError = vi.fn();
    const player = new AudioStreamPlayer({ onError });
    await player.connect();
    FakeWorklet.instances[0].port.postMessage.mockImplementationOnce(() => {
      throw new Error("Port closed");
    });
    expect(await player.interrupt()).toEqual({ trackId: null, offsetSamples: 0, wasPlaying: false });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(FakeWorklet.instances[0].port.close).toHaveBeenCalled();
  });

  it("disconnects during sink selection without starting late playback", async () => {
    const sink = deferred();
    FakeAudio.setSinkId.mockReturnValueOnce(sink.promise);
    const player = new AudioStreamPlayer({ sinkId: "speakers" });
    const connecting = player.connect().catch(() => {});
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    await player.disconnect();
    sink.resolve();
    await connecting;
    expect(FakeAudio.instances[0].play).not.toHaveBeenCalled();
    expect(FakeAudio.instances[0].srcObject).toBeNull();
    expect(FakeContext.instances[0].output.stream.track.stop).toHaveBeenCalled();
  });

  it("rejects playback failure and releases the output stream", async () => {
    FakeAudio.play.mockRejectedValueOnce(new Error("autoplay denied"));
    const player = new AudioStreamPlayer({ sinkId: "speakers" });
    await expect(player.connect()).rejects.toThrow("autoplay denied");
    expect(FakeAudio.instances[0].srcObject).toBeNull();
    expect(FakeContext.instances[0].output.stream.track.stop).toHaveBeenCalled();
    expect(FakeContext.instances[0].close).toHaveBeenCalled();
  });

  it("settles all interrupts and closes the port on disconnect", async () => {
    const player = new AudioStreamPlayer();
    await player.connect();
    const results = [player.interrupt(), player.interrupt()];
    await player.disconnect();
    expect(await Promise.all(results)).toEqual([
      { trackId: null, offsetSamples: 0, wasPlaying: false },
      { trackId: null, offsetSamples: 0, wasPlaying: false },
    ]);
    expect(FakeWorklet.instances[0].port.close).toHaveBeenCalledTimes(1);
    expect(audio.revoke).toHaveBeenCalledTimes(1);
  });
});
