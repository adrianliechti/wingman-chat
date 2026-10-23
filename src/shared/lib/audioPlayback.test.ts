import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playAudioBlob } from "./audioPlayback";
import { Client } from "./client";
import { deferred, FakeAudio, installAudioFakes } from "@/features/voice/lib/audioTestSupport";

let audio: ReturnType<typeof installAudioFakes>;
beforeEach(() => {
  audio = installAudioFakes();
  vi.stubGlobal("window", { location: new URL("http://localhost") });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("read-aloud playback", () => {
  it.each(["ended", "error", "play failure", "sink failure", "cancel"])(
    "releases the element and URL after %s",
    async (outcome) => {
      if (outcome === "play failure") FakeAudio.play.mockRejectedValueOnce(new Error("Blocked playback"));
      if (outcome === "sink failure") FakeAudio.setSinkId.mockRejectedValueOnce(new Error("Device removed"));
      const controller = new AbortController();
      const playing = vi.fn();
      const promise = playAudioBlob(new Blob(["sound"]), {
        sinkId: "speakers",
        signal: controller.signal,
        onPlaying: playing,
      });
      const result = promise.catch((error: unknown) => error);
      const element = FakeAudio.instances[0];
      if (outcome === "cancel") controller.abort();
      else if (outcome === "ended" || outcome === "error") {
        await vi.waitFor(() => expect(playing).toHaveBeenCalledTimes(1));
        element.dispatchEvent(new Event(outcome));
      }
      if (outcome === "ended") expect(await result).toBeUndefined();
      else expect(await result).toBeInstanceOf(Error);
      expect(audio.revoke).toHaveBeenCalledTimes(1);
      expect(element.pause).toHaveBeenCalledTimes(1);
      expect(element.removeAttribute).toHaveBeenCalledWith("src");
      expect(element.load).toHaveBeenCalledTimes(1);
    },
  );

  it("cancels a pending sink selection without playing late audio", async () => {
    const selection = deferred();
    FakeAudio.setSinkId.mockReturnValueOnce(selection.promise);
    const controller = new AbortController();
    const promise = playAudioBlob(new Blob(["sound"]), { sinkId: "speakers", signal: controller.signal });
    const result = promise.catch((error: unknown) => error);
    controller.abort();
    expect(await result).toMatchObject({ name: "AbortError" });
    selection.resolve();
    await Promise.resolve();
    expect(FakeAudio.play).not.toHaveBeenCalled();
    expect(audio.revoke).toHaveBeenCalledTimes(1);
  });

  it("does not play a late synthesis result after cancellation", async () => {
    const client = new Client();
    const synthesis = deferred<Blob>();
    const generate = vi.spyOn(client, "generateAudio").mockReturnValueOnce(synthesis.promise);
    const controller = new AbortController();
    const promise = client.speakText("tts", "Hello", "narrator", "speakers", { signal: controller.signal });
    const result = promise.catch((error: unknown) => error);
    controller.abort();
    synthesis.resolve(new Blob(["sound"]));
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(generate.mock.calls[0][3]?.signal).toBe(controller.signal);
    expect(FakeAudio.instances).toHaveLength(0);
    expect(audio.blobs.size).toBe(0);
  });
});
