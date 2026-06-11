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
    this.playedSamples = {};

    this.port.onmessage = (e) => {
      const { event, buffer, trackId } = e.data;
      if (event === 'write') {
        // If this track was interrupted, ignore new data for it
        if (this.interruptedTrackIds.has(trackId)) {
          return;
        }
        this.currentTrackId = trackId;
        this.buffers.push({ samples: buffer, trackId });
      } else if (event === 'interrupt') {
        const playingTrackId = this.currentBufferTrackId || this.lastPlayedTrackId || this.currentTrackId;
        const wasPlaying = !!this.currentBuffer || this.buffers.length > 0;
        // Mark both the playing and the last written track as interrupted
        if (playingTrackId) {
          this.interruptedTrackIds.add(playingTrackId);
        }
        if (this.currentTrackId) {
          this.interruptedTrackIds.add(this.currentTrackId);
        }
        this.buffers = [];
        this.currentBuffer = null;
        this.currentBufferTrackId = null;
        this.currentOffset = 0;
        this.port.postMessage({
          event: 'interrupted',
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

export class AudioStreamPlayer {
  private sampleRate: number;
  private sinkId: string | undefined;
  private context: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private pendingInterrupts: Array<(result: InterruptResult) => void> = [];

  constructor(options: AudioStreamPlayerOptions = {}) {
    this.sampleRate = options.sampleRate ?? 24000;
    this.sinkId = options.sinkId;
  }

  /**
   * Connect to audio output and initialize AudioWorklet
   */
  async connect(): Promise<void> {
    // Create AudioContext with specified sample rate
    this.context = new AudioContext({ sampleRate: this.sampleRate });

    // Resume context if suspended (browser autoplay policy)
    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    // Create Blob URL for worklet code
    const blob = new Blob([streamProcessorCode], { type: "application/javascript" });
    const workletUrl = URL.createObjectURL(blob);

    try {
      // Load the worklet module
      await this.context.audioWorklet.addModule(workletUrl);
    } finally {
      // Clean up blob URL
      URL.revokeObjectURL(workletUrl);
    }

    // Create and connect the worklet node
    this.workletNode = new AudioWorkletNode(this.context, "stream-processor");

    this.workletNode.port.onmessage = (e) => {
      if (e.data?.event === "interrupted") {
        const resolve = this.pendingInterrupts.shift();
        resolve?.({
          trackId: (e.data.trackId as string | undefined) ?? null,
          offsetSamples: (e.data.offset as number | undefined) ?? 0,
          wasPlaying: !!e.data.wasPlaying,
        });
      }
    };

    // Route to a specific output device via MediaStream + HTMLAudioElement,
    // which has broader setSinkId support than AudioContext.setSinkId.
    if (this.sinkId) {
      const dest = this.context.createMediaStreamDestination();
      this.workletNode.connect(dest);

      const audio = new Audio();
      audio.srcObject = dest.stream;

      if ("setSinkId" in audio) {
        try {
          await (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(this.sinkId);
        } catch (err) {
          console.warn("Failed to set output device, falling back to default:", err);
        }
      }

      audio.play().catch(console.warn);
      this.audioEl = audio;
    } else {
      this.workletNode.connect(this.context.destination);
    }
  }

  /**
   * Add PCM16 audio data for playback
   */
  add16BitPCM(samples: Int16Array, trackId: string): void {
    if (!this.workletNode) {
      return;
    }

    this.workletNode.port.postMessage({
      event: "write",
      buffer: samples,
      trackId,
    });
  }

  /**
   * Interrupt current playback. Resolves with the playback position of the
   * interrupted track so callers can truncate server-side conversation state.
   */
  interrupt(): Promise<InterruptResult> {
    const node = this.workletNode;
    if (!node) {
      return Promise.resolve(NOOP_INTERRUPT);
    }
    return new Promise((resolve) => {
      this.pendingInterrupts.push(resolve);
      node.port.postMessage({ event: "interrupt" });
    });
  }

  /**
   * Disconnect and clean up resources
   */
  disconnect(): void {
    // Settle outstanding interrupts — the worklet will never answer them.
    for (const resolve of this.pendingInterrupts.splice(0)) {
      resolve(NOOP_INTERRUPT);
    }
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.srcObject = null;
      this.audioEl = null;
    }
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.context) {
      this.context.close();
      this.context = null;
    }
  }
}
