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
      const { event } = e.data;
      if (event === 'start') {
        this.recording = true;
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
      mono: pcm16.buffer
    }, [pcm16.buffer]);
    
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
`;

export interface AudioRecorderOptions {
  sampleRate?: number;
}

export interface AudioChunk {
  mono: ArrayBuffer;
}

export type ChunkCallback = (chunk: AudioChunk) => void;

export class AudioRecorder {
  private sampleRate: number;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private chunkCallback: ChunkCallback | null = null;
  private recording = false;

  constructor(options: AudioRecorderOptions = {}) {
    this.sampleRate = options.sampleRate ?? 24000;
  }

  /**
   * Initialize microphone access and AudioWorklet
   */
  async begin(): Promise<void> {
    // Get microphone access
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: this.sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      }
    });

    // Create AudioContext
    this.context = new AudioContext({ sampleRate: this.sampleRate });
    
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    // Create Blob URL for worklet code
    const blob = new Blob([audioProcessorCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);

    try {
      await this.context.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }

    // Create source from microphone stream
    this.source = this.context.createMediaStreamSource(this.stream);

    // Create worklet node
    this.workletNode = new AudioWorkletNode(this.context, 'audio-processor');
    
    // Handle chunks from worklet
    this.workletNode.port.onmessage = (e) => {
      const { event, mono } = e.data;
      if (event === 'chunk' && this.chunkCallback && this.recording) {
        this.chunkCallback({ mono });
      }
    };

    // Connect: source -> processor (no output to speakers)
    this.source.connect(this.workletNode);
  }

  /**
   * Start recording and delivering chunks via callback
   */
  async record(callback: ChunkCallback): Promise<void> {
    if (!this.workletNode) {
      throw new Error('AudioRecorder not initialized. Call begin() first.');
    }

    this.chunkCallback = callback;
    this.recording = true;
    this.workletNode.port.postMessage({ event: 'start' });
  }

  /**
   * Pause recording but keep microphone open
   */
  async pause(): Promise<void> {
    if (this.workletNode && this.recording) {
      this.recording = false;
      this.workletNode.port.postMessage({ event: 'stop' });
    }
  }

  /**
   * End recording session and release resources
   */
  async end(): Promise<void> {
    this.recording = false;
    this.chunkCallback = null;

    // Stop worklet
    if (this.workletNode) {
      this.workletNode.port.postMessage({ event: 'stop' });
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    // Disconnect source
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    // Stop all tracks
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    // Close context
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}
