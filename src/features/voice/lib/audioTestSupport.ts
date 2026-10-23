import { vi } from "vitest";

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export class FakeTrack extends EventTarget {
  readyState = "live";
  stop = vi.fn(() => {
    this.readyState = "ended";
  });
  end() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

export function fakeStream() {
  const track = new FakeTrack();
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}

export class FakeNode extends EventTarget {
  connect = vi.fn();
  disconnect = vi.fn();
}

export class FakeWorklet extends FakeNode {
  static instances: FakeWorklet[] = [];
  port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
  };
  readonly context: FakeContext;
  readonly name: string;
  constructor(context: FakeContext, name: string) {
    super();
    this.context = context;
    this.name = name;
    FakeWorklet.instances.push(this);
  }
  receive(data: unknown) {
    this.port.onmessage?.(new MessageEvent("message", { data }));
  }
}

export class FakeContext extends EventTarget {
  static instances: FakeContext[] = [];
  static resume = vi.fn(async () => {});
  static addModule = vi.fn(async (_url: string) => {});
  static close = vi.fn(async () => {});
  state = "suspended";
  destination = new FakeNode();
  source = new FakeNode();
  output = Object.assign(new FakeNode(), { stream: fakeStream() });
  audioWorklet = { addModule: vi.fn((url: string) => FakeContext.addModule(url)) };
  resume = vi.fn(async () => {
    await FakeContext.resume();
    this.state = "running";
  });
  close = vi.fn(async () => {
    await FakeContext.close();
    this.state = "closed";
  });
  createMediaStreamSource = vi.fn(() => this.source);
  createMediaStreamDestination = vi.fn(() => this.output);
  readonly options: AudioContextOptions;
  constructor(options: AudioContextOptions) {
    super();
    this.options = options;
    FakeContext.instances.push(this);
  }
}

export class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  static setSinkId = vi.fn(async (_id: string) => {});
  static play = vi.fn(async () => {});
  srcObject: unknown = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  setSinkId = vi.fn((id: string) => FakeAudio.setSinkId(id));
  play = vi.fn(() => FakeAudio.play());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  readonly src: string;
  constructor(src = "") {
    super();
    this.src = src;
    FakeAudio.instances.push(this);
  }
}

export function installAudioFakes() {
  FakeContext.instances = [];
  FakeWorklet.instances = [];
  FakeAudio.instances = [];
  FakeContext.resume.mockReset().mockResolvedValue();
  FakeContext.addModule.mockReset().mockResolvedValue();
  FakeContext.close.mockReset().mockResolvedValue();
  FakeAudio.setSinkId.mockReset().mockResolvedValue();
  FakeAudio.play.mockReset().mockResolvedValue();
  const stream = fakeStream();
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorklet);
  vi.stubGlobal("Audio", FakeAudio);
  const blobs = new Map<string, Blob>();
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    const url = `blob:${blobs.size}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { stream, getUserMedia, blobs, revoke };
}
