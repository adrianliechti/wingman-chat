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
    this.currentOffset = 0;
    this.interrupted = false;
    this.interruptedTrackIds = new Set();
    this.currentTrackId = null;
    
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
        // Mark current track as interrupted
        if (this.currentTrackId) {
          this.interruptedTrackIds.add(this.currentTrackId);
        }
        this.buffers = [];
        this.currentBuffer = null;
        this.currentOffset = 0;
        this.interrupted = true;
        this.port.postMessage({ event: 'interrupted' });
      } else if (event === 'clear') {
        this.interruptedTrackIds.clear();
        this.interrupted = false;
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
      
      // Move to next buffer if current is exhausted
      if (this.currentOffset >= this.currentBuffer.length) {
        this.currentBuffer = null;
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
}

export class AudioStreamPlayer {
  private sampleRate: number;
  private context: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private interruptedTrackIds: Set<string> = new Set();

  constructor(options: AudioStreamPlayerOptions = {}) {
    this.sampleRate = options.sampleRate ?? 24000;
  }

  /**
   * Connect to audio output and initialize AudioWorklet
   */
  async connect(): Promise<void> {
    // Create AudioContext with specified sample rate
    this.context = new AudioContext({ sampleRate: this.sampleRate });
    
    // Resume context if suspended (browser autoplay policy)
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    // Create Blob URL for worklet code
    const blob = new Blob([streamProcessorCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);

    try {
      // Load the worklet module
      await this.context.audioWorklet.addModule(workletUrl);
    } finally {
      // Clean up blob URL
      URL.revokeObjectURL(workletUrl);
    }

    // Create and connect the worklet node
    this.workletNode = new AudioWorkletNode(this.context, 'stream-processor');
    this.workletNode.connect(this.context.destination);
  }

  /**
   * Add PCM16 audio data for playback
   */
  add16BitPCM(samples: Int16Array, trackId: string): void {
    if (!this.workletNode) {
      console.warn('AudioStreamPlayer not connected');
      return;
    }

    // If this track was interrupted, ignore
    if (this.interruptedTrackIds.has(trackId)) {
      return;
    }

    // Send samples to worklet
    this.workletNode.port.postMessage({
      event: 'write',
      buffer: samples,
      trackId
    });
  }

  /**
   * Interrupt current playback
   */
  interrupt(): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ event: 'interrupt' });
    }
  }

  /**
   * Clear interrupted track IDs to allow playback again
   */
  clearInterrupts(): void {
    this.interruptedTrackIds.clear();
    if (this.workletNode) {
      this.workletNode.port.postMessage({ event: 'clear' });
    }
  }

  /**
   * Disconnect and clean up resources
   */
  disconnect(): void {
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
