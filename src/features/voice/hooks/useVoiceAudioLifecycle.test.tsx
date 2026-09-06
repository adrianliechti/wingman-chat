import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceWebSockets } from "./useVoiceWebSockets";
import { deferred, fakeStream, FakeContext, FakeWorklet, installAudioFakes } from "../lib/audioTestSupport";

class Socket extends EventTarget {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  url: string;
  constructor(url: string) {
    super();
    this.url = url;
    Socket.instances.push(this);
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error("Socket is closed");
    this.sent.push(JSON.parse(data));
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  message(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
  close = vi.fn(() => {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  });
}

let audio: ReturnType<typeof installAudioFakes>;
beforeEach(() => {
  audio = installAudioFakes();
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("window", {
    location: new URL("http://localhost"),
    setTimeout: (callback: () => void, delay?: number) => setTimeout(callback, delay),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function harness() {
  let hook!: ReturnType<typeof useVoiceWebSockets>;
  const closed = vi.fn();
  const ready = vi.fn();
  function Harness() {
    hook = useVoiceWebSockets(vi.fn(), vi.fn(), undefined, undefined, undefined, closed);
    return null;
  }
  renderToString(<Harness />);
  return {
    hook,
    closed,
    ready,
    start: async (ack = true) => {
      await hook.start(
        "voice/model ?&",
        "transcriber",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ready,
      );
      const socket = Socket.instances.at(-1)!;
      socket.open();
      if (ack) socket.message({ type: "session.updated" });
      await Promise.resolve();
      return socket;
    },
  };
}

describe("voice sessions using the actual recorder and player", () => {
  it("stops permission-pending startup immediately and releases a late stream", async () => {
    const permission = deferred<ReturnType<typeof fakeStream>>();
    audio.getUserMedia.mockReturnValueOnce(permission.promise);
    const { hook } = harness();
    const starting = hook.start();
    await vi.waitFor(() => expect(audio.getUserMedia).toHaveBeenCalled());
    await hook.stop();
    await starting;
    expect(FakeContext.instances.every((context) => context.state === "closed")).toBe(true);
    permission.resolve(audio.stream);
    await vi.waitFor(() => expect(audio.stream.track.stop).toHaveBeenCalledTimes(1));
    expect(Socket.instances).toHaveLength(0);
  });

  it("an old stop cannot close or clear a restarted session", async () => {
    const { hook, start, closed } = harness();
    const old = await start();
    const closing = deferred();
    FakeContext.close.mockReturnValueOnce(closing.promise);
    const stopping = hook.stop();
    expect(old.close).toHaveBeenCalled();
    const replacement = fakeStream();
    audio.getUserMedia.mockResolvedValueOnce(replacement);
    const next = await start();
    closing.resolve();
    await stopping;
    hook.sendText("Still connected");
    expect(next.sent.at(-1)).toEqual({ type: "response.create" });
    expect(next.close).not.toHaveBeenCalled();
    expect(replacement.track.stop).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    await hook.stop();
    expect(replacement.track.stop).toHaveBeenCalled();
  });

  it.each(["microphone", "recorder processor", "player processor", "socket"])(
    "releases all resources on %s failure",
    async (failure) => {
      const { hook, start, closed } = harness();
      const socket = await start();
      if (failure === "microphone") audio.stream.track.end();
      else if (failure === "socket") socket.dispatchEvent(new Event("error"));
      else
        FakeWorklet.instances
          .find((node) => node.name === (failure === "recorder processor" ? "audio-processor" : "stream-processor"))!
          .dispatchEvent(new Event("processorerror"));
      await vi.waitFor(() => expect(FakeContext.instances.every((context) => context.state === "closed")).toBe(true));
      expect(audio.stream.track.stop).toHaveBeenCalled();
      expect(socket.close).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledTimes(1);
      expect(closed.mock.calls[0][0]).toMatchObject({ fatal: true });
      await hook.stop();
    },
  );

  it("pauses until every elicitation resumes, and old resumes cannot affect a new session", async () => {
    const { hook, start } = harness();
    await start();
    const resumeA = await hook.pauseAudio(false);
    const resumeB = await hook.pauseAudio(false);
    const recorder = FakeWorklet.instances.find((node) => node.name === "audio-processor")!;
    recorder.port.postMessage.mockClear();
    await resumeA();
    expect(recorder.port.postMessage).not.toHaveBeenCalled();
    await resumeB();
    expect(recorder.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ event: "start" }));
    const staleResume = await hook.pauseAudio(false);
    await hook.stop();
    audio.getUserMedia.mockResolvedValueOnce(fakeStream());
    await start();
    const resumeNew = await hook.pauseAudio(false);
    const newRecorder = FakeWorklet.instances.at(-1)!;
    newRecorder.port.postMessage.mockClear();
    await staleResume();
    expect(newRecorder.port.postMessage).not.toHaveBeenCalled();
    await resumeNew();
    expect(newRecorder.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ event: "start" }));
    await hook.stop();
  });

  it("times out missing configuration instead of recording with unknown settings", async () => {
    vi.useFakeTimers();
    const { hook, start, closed, ready } = harness();
    const socket = await start(false);
    expect(new URL(socket.url).searchParams.get("model")).toBe("voice/model ?&");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ready).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(audio.stream.track.stop).toHaveBeenCalled();
    await hook.stop();
  });

  it("times out a socket that never opens and ignores its late open", async () => {
    vi.useFakeTimers();
    const { hook, closed } = harness();
    await hook.start();
    const socket = Socket.instances[0];
    await vi.advanceTimersByTimeAsync(15_000);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(audio.stream.track.stop).toHaveBeenCalled();
    socket.open();
    expect(socket.sent).toEqual([]);
  });

  it("clears the connection/ready deadline when stopped, even if close emits no event", async () => {
    vi.useFakeTimers();
    const { hook, start, ready, closed } = harness();
    const socket = await start(false);
    socket.close.mockImplementation(() => {
      socket.readyState = 3;
    });
    await hook.stop();
    audio.getUserMedia.mockResolvedValueOnce(fakeStream());
    await start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();
    await hook.stop();
  });

  it("cleans up malformed frames and rejected initial configuration", async () => {
    for (const invalid of ["bad JSON", JSON.stringify({ type: "error", error: { message: "Invalid transcriber" } })]) {
      audio.getUserMedia.mockResolvedValueOnce(fakeStream());
      const { start, closed, ready } = harness();
      const socket = await start(false);
      socket.dispatchEvent(new MessageEvent("message", { data: invalid }));
      expect(closed).toHaveBeenCalledTimes(1);
      expect(ready).not.toHaveBeenCalled();
      expect(socket.close).toHaveBeenCalled();
    }
  });
});
