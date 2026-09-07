import {
  AudioResources,
  loadAudioWorklet,
  ownAudioNode,
  ownAudioWorklet,
  stopAudioTracks,
} from "@/shared/lib/audioResources";

/**
 * AudioStreamPlayer - Plays streaming PCM16 audio using AudioWorklet
 * Replacement for wavtools WavStreamPlayer
 */

// Inline AudioWorklet processor code for streaming playback
const streamProcessorCode = `
class StreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = [];
    this.currentBuffer = null;
    this.currentBufferTrackId = null;
    this.currentOffset = 0;
    this.interruptedTrackIds = new Set();
    this.currentTrackId = null;
    this.lastPlayedTrackId = null;
    this.playedSamples = Object.create(null);

    this.port.onmessage = (e) => {
      const { event, buffer, trackId, requestId } = e.data;
      if (event === 'write') {
        // If this track was interrupted, ignore new data for it
        if (this.interruptedTrackIds.has(trackId)) {
          return;
        }
        this.currentTrackId = trackId;
        this.buffers.push({ samples: buffer, trackId });
      } else if (event === 'interrupt') {
        const playingTrackId = this.currentBufferTrackId || this.buffers[0]?.trackId || this.lastPlayedTrackId;
        const wasPlaying = !!this.currentBuffer || this.buffers.length > 0;
        // Mark both the playing and the last written track as interrupted
        if (playingTrackId) {
          this.interruptedTrackIds.add(playingTrackId);
        }
        for (const queued of this.buffers) this.interruptedTrackIds.add(queued.trackId);
        if (this.currentTrackId) this.interruptedTrackIds.add(this.currentTrackId);
        this.buffers = [];
        this.currentBuffer = null;
        this.currentBufferTrackId = null;
        this.currentOffset = 0;
        this.port.postMessage({
          event: 'interrupted',
          requestId,
          trackId: playingTrackId,
          offset: playingTrackId ? (this.playedSamples[playingTrackId] || 0) : 0,
          wasPlaying,
        });
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    
    const channel = output[0];
    let outputOffset = 0;
    
    while (outputOffset < channel.length) {
      // Get next buffer if needed
      if (!this.currentBuffer && this.buffers.length > 0) {
        const next = this.buffers.shift();
        this.currentBuffer = next.samples;
        this.currentBufferTrackId = next.trackId;
        this.currentOffset = 0;
      }
      
      if (!this.currentBuffer) {
        // No data - output silence
        channel.fill(0, outputOffset);
        break;
      }
      
      // Copy samples from current buffer
      const remaining = this.currentBuffer.length - this.currentOffset;
      const needed = channel.length - outputOffset;
      const toCopy = Math.min(remaining, needed);
      
      for (let i = 0; i < toCopy; i++) {
        // Convert Int16 to Float32 (-1 to 1)
        channel[outputOffset + i] = this.currentBuffer[this.currentOffset + i] / 0x8000;
      }
      
      this.currentOffset += toCopy;
      outputOffset += toCopy;

      // Track playback progress per track so interrupts can report
      // how much of a track was actually heard
      if (this.currentBufferTrackId) {
        this.playedSamples[this.currentBufferTrackId] =
          (this.playedSamples[this.currentBufferTrackId] || 0) + toCopy;
        this.lastPlayedTrackId = this.currentBufferTrackId;
      }

      // Move to next buffer if current is exhausted
      if (this.currentOffset >= this.currentBuffer.length) {
        this.currentBuffer = null;
        this.currentBufferTrackId = null;
        this.currentOffset = 0;
      }
    }
    
    return true;
  }
}

registerProcessor('stream-processor', StreamProcessor);
`;

export interface AudioStreamPlayerOptions {
  sampleRate?: number;
  sinkId?: string;
  onError?: (error: Error) => void;
}

export interface InterruptResult {
  /** Track that was playing when the interrupt landed (null if nothing played yet). */
  trackId: string | null;
  /** Samples of that track actually played back so far. */
  offsetSamples: number;
  /** False when playback had already drained — the listener heard everything. */
  wasPlaying: boolean;
}

const NOOP_INTERRUPT: InterruptResult = { trackId: null, offsetSamples: 0, wasPlaying: false };

interface PlaybackSession {
  scope: AudioResources;
  ready: Promise<void>;
  node?: AudioWorkletNode;
  interrupts: Map<number, (result: InterruptResult) => void>;
  nextInterrupt: number;
}

export class AudioStreamPlayer {
  private session?: PlaybackSession;

  private options: AudioStreamPlayerOptions;
  constructor(options: AudioStreamPlayerOptions = {}) {
    this.options = options;
  }

  connect(): Promise<void> {
    if (this.session) return this.session.ready;
    const session: PlaybackSession = {
      scope: new AudioResources(),
      ready: Promise.resolve(),
      interrupts: new Map(),
      nextInterrupt: 0,
    };
    this.session = session;
    session.scope.own(session.interrupts, (interrupts) => {
      for (const resolve of interrupts.values()) resolve(NOOP_INTERRUPT);
      interrupts.clear();
    });
    session.ready = this.initialize(session).catch(async (error: unknown) => {
      if (this.session === session) this.session = undefined;
      await session.scope.close();
      throw error;
    });
    return session.ready;
  }

  private fail(session: PlaybackSession, error: Error) {
    if (this.session !== session) return;
    void this.disconnect();
    this.options.onError?.(error);
  }

  private async initialize(session: PlaybackSession): Promise<void> {
    const { scope } = session;
    const context = scope.own(new AudioContext({ sampleRate: this.options.sampleRate ?? 24000 }), (context) =>
      context.close(),
    );
    if (context.state === "suspended") await scope.wait(context.resume());
    scope.signal.throwIfAborted();
    await loadAudioWorklet(scope, context, streamProcessorCode);
    scope.signal.throwIfAborted();
    const node = ownAudioWorklet(
      scope,
      new AudioWorkletNode(context, "stream-processor", { numberOfInputs: 0, outputChannelCount: [1] }),
    );
    scope.listen(node, "processorerror", () => this.fail(session, new Error("The playback audio processor failed.")));
    node.port.onmessage = (event) => {
      if (scope.signal.aborted || event.data?.event !== "interrupted") return;
      session.interrupts.get(event.data.requestId)?.({
        trackId: event.data.trackId ?? null,
        offsetSamples: event.data.offset ?? 0,
        wasPlaying: !!event.data.wasPlaying,
      });
    };

    if (this.options.sinkId) {
      const destination = ownAudioNode(scope, context.createMediaStreamDestination());
      scope.own(destination.stream, stopAudioTracks);
      const audio = new Audio();
      scope.own(audio, (audio) => {
        audio.srcObject = null;
      });
      scope.own(audio, (audio) => audio.pause());
      scope.listen(audio, "error", () =>
        this.fail(session, new Error("Audio output failed. Please select an output device and restart.")),
      );
      audio.srcObject = destination.stream;
      node.connect(destination);
      if ("setSinkId" in audio) {
        // Surface a missing/denied output device instead of silently playing somewhere else.
        await scope.wait(audio.setSinkId(this.options.sinkId));
      }
      scope.signal.throwIfAborted();
      await scope.wait(audio.play());
    } else {
      node.connect(context.destination);
    }
    scope.signal.throwIfAborted();
    session.node = node;
  }

  add16BitPCM(samples: Int16Array, trackId: string): void {
    const session = this.session;
    if (!session?.node || samples.length === 0) return;
    try {
      session.node.port.postMessage({ event: "write", buffer: samples, trackId });
    } catch {
      this.fail(session, new Error("Couldn't send audio to the playback processor."));
    }
  }

  interrupt(): Promise<InterruptResult> {
    const session = this.session;
    if (!session?.node) return Promise.resolve(NOOP_INTERRUPT);
    return new Promise((resolve) => {
      const requestId = ++session.nextInterrupt;
      const timeout = setTimeout(
        () => this.fail(session, new Error("The audio playback processor stopped responding.")),
        2000,
      );
      session.interrupts.set(requestId, (result) => {
        clearTimeout(timeout);
        session.interrupts.delete(requestId);
        resolve(result);
      });
      try {
        session.node!.port.postMessage({ event: "interrupt", requestId });
      } catch {
        this.fail(session, new Error("Couldn't interrupt audio playback."));
      }
    });
  }

  disconnect(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    return session?.scope.close() ?? Promise.resolve();
  }
}
