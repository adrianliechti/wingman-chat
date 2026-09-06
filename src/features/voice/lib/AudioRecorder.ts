import {
  AudioResources,
  loadAudioWorklet,
  ownAudioNode,
  ownAudioWorklet,
  stopAudioTracks,
} from "@/shared/lib/audioResources";

/**
 * AudioRecorder - Records microphone audio as PCM16 using AudioWorklet
 * Replacement for wavtools WavRecorder
 */

// Inline AudioWorklet processor code for recording
const audioProcessorCode = `
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.foundAudio = false;
    
    this.port.onmessage = (e) => {
      const { event, recordingId } = e.data;
      if (event === 'start') {
        this.recording = true;
        this.recordingId = recordingId;
        this.foundAudio = false;
      } else if (event === 'stop') {
        this.recording = false;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || !this.recording) return true;
    
    const samples = input[0];
    
    // Wait for first non-zero sample to avoid initial silence/latency
    if (!this.foundAudio) {
      let hasAudio = false;
      for (let i = 0; i < samples.length; i++) {
        if (samples[i] !== 0) {
          hasAudio = true;
          break;
        }
      }
      if (!hasAudio) return true;
      this.foundAudio = true;
    }
    
    // Convert Float32 to Int16 PCM
    const pcm16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    
    // Send chunk to main thread
    this.port.postMessage({
      event: 'chunk',
      recordingId: this.recordingId,
      mono: pcm16.buffer
    }, [pcm16.buffer]);
    
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
`;

export interface AudioRecorderOptions {
  sampleRate?: number;
  deviceId?: string;
  onError?: (error: Error) => void;
}

export interface AudioChunk {
  mono: ArrayBuffer;
}

export type ChunkCallback = (chunk: AudioChunk) => void;

interface RecordingSession {
  scope: AudioResources;
  ready: Promise<void>;
  node?: AudioWorkletNode;
  callback?: ChunkCallback;
  recording: boolean;
  recordingId: number;
}

export class AudioRecorder {
  private session?: RecordingSession;

  private options: AudioRecorderOptions;
  constructor(options: AudioRecorderOptions = {}) {
    this.options = options;
  }

  /** Repeated begin calls share setup; end invalidates it even during a permission prompt. */
  begin(): Promise<void> {
    if (this.session) return this.session.ready;
    const session: RecordingSession = {
      scope: new AudioResources(),
      ready: Promise.resolve(),
      recording: false,
      recordingId: 0,
    };
    this.session = session;
    session.ready = this.initialize(session).catch(async (error: unknown) => {
      if (this.session === session) this.session = undefined;
      await session.scope.close();
      throw error;
    });
    return session.ready;
  }

  private async initialize(session: RecordingSession): Promise<void> {
    const { scope } = session;
    const sampleRate = this.options.sampleRate ?? 24000;
    const fail = (error: Error) => {
      if (this.session !== session) return;
      void this.end();
      this.options.onError?.(error);
    };
    const stream = await scope.wait(
      navigator.mediaDevices
        .getUserMedia({
          audio: {
            ...(this.options.deviceId && { deviceId: { exact: this.options.deviceId } }),
            sampleRate,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        })
        .then((stream) => scope.own(stream, stopAudioTracks)),
    );
    scope.signal.throwIfAborted();
    const tracks = stream.getAudioTracks();
    if (!tracks.length || tracks.some((track) => track.readyState === "ended")) {
      throw new Error("The microphone is disconnected.");
    }
    for (const track of tracks) {
      scope.listen(track, "ended", () =>
        fail(new Error("The microphone was disconnected. Please select a microphone and restart.")),
      );
    }
    const context = scope.own(new AudioContext({ sampleRate }), (context) => context.close());
    if (context.state === "suspended") await scope.wait(context.resume());
    scope.signal.throwIfAborted();
    await loadAudioWorklet(scope, context, audioProcessorCode);
    scope.signal.throwIfAborted();
    const source = ownAudioNode(scope, context.createMediaStreamSource(stream));
    const node = ownAudioWorklet(scope, new AudioWorkletNode(context, "audio-processor"));
    scope.listen(node, "processorerror", () => fail(new Error("The microphone audio processor failed.")));
    node.port.onmessage = (event) => {
      if (
        this.session === session &&
        session.recording &&
        event.data?.event === "chunk" &&
        event.data.recordingId === session.recordingId
      ) {
        session.callback?.({ mono: event.data.mono });
      }
    };
    // The processor writes silence to its output; keep the graph running without microphone monitoring.
    source.connect(node);
    node.connect(context.destination);
    session.node = node;
  }

  async record(callback: ChunkCallback): Promise<void> {
    const session = this.session;
    if (!session?.node) throw new Error("AudioRecorder not initialized. Call begin() first.");
    session.callback = callback;
    session.node.port.postMessage({ event: "start", recordingId: ++session.recordingId });
    session.recording = true;
  }

  /** Pause discards subsequent chunks but keeps the microphone available. */
  async pause(): Promise<void> {
    const session = this.session;
    if (!session) return;
    session.recording = false;
    session.callback = undefined;
    session.node?.port.postMessage({ event: "stop" });
  }

  end(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    if (!session) return Promise.resolve();
    session.recording = false;
    session.callback = undefined;
    return session.scope.close();
  }
}
