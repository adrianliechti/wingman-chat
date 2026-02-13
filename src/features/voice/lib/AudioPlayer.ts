/**
 * AudioPlayer - Plays audio blobs/files with seeking and position tracking
 * Designed for tape-deck style playback (load, play, pause, seek)
 */

import { audioBufferToWav } from './audio';

export interface AudioPlayerOptions {
  onTimeUpdate?: (position: number) => void;
  onEnded?: () => void;
  onDurationChange?: (duration: number) => void;
}

export interface AudioSegment {
  blob: Blob;
  duration: number;
}

export class AudioPlayer {
  private audio: HTMLAudioElement;
  private segments: AudioSegment[] = [];
  private mergedUrl: string | null = null;
  private options: AudioPlayerOptions;

  constructor(options: AudioPlayerOptions = {}) {
    this.options = options;
    this.audio = new Audio();
    
    this.audio.addEventListener('timeupdate', () => {
      if (this.options.onTimeUpdate) {
        this.options.onTimeUpdate(this.audio.currentTime);
      }
    });
    
    this.audio.addEventListener('ended', () => {
      if (this.options.onEnded) {
        this.options.onEnded();
      }
    });
    
    this.audio.addEventListener('durationchange', () => {
      if (this.options.onDurationChange && Number.isFinite(this.audio.duration)) {
        this.options.onDurationChange(this.audio.duration);
      }
    });
  }

  /**
   * Load a single audio blob for playback
   */
  async load(blob: Blob): Promise<number> {
    this.clearSegments();
    
    const url = URL.createObjectURL(blob);
    this.mergedUrl = url;
    this.audio.src = url;
    
    // Wait for metadata to get duration
    await this.waitForReady();
    return this.audio.duration;
  }

  /**
   * Add a segment to the playlist
   */
  addSegment(segment: AudioSegment): void {
    this.segments.push(segment);
    // Invalidate merged URL - will rebuild on play
    if (this.mergedUrl) {
      URL.revokeObjectURL(this.mergedUrl);
      this.mergedUrl = null;
    }
  }

  /**
   * Clear all segments
   */
  clearSegments(): void {
    this.segments = [];
    if (this.mergedUrl) {
      URL.revokeObjectURL(this.mergedUrl);
      this.mergedUrl = null;
    }
    this.audio.src = '';
  }

  /**
   * Get total duration of all segments
   */
  getTotalDuration(): number {
    return this.segments.reduce((sum, seg) => sum + seg.duration, 0);
  }

  /**
   * Get the merged blob of all segments (for download/transcription)
   */
  async getMergedBlob(): Promise<Blob | null> {
    if (this.segments.length === 0) return null;
    
    if (this.segments.length === 1) {
      return this.segments[0].blob;
    }
    
    // Decode and merge all segments into WAV
    const audioContext = new AudioContext();
    const audioBuffers: AudioBuffer[] = [];
    
    for (const segment of this.segments) {
      const arrayBuffer = await segment.blob.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      audioBuffers.push(decoded);
    }
    
    // Calculate total length
    let totalLength = 0;
    const sampleRate = audioBuffers[0].sampleRate;
    for (const buf of audioBuffers) {
      totalLength += buf.length;
    }
    
    // Create merged buffer
    const mergedBuffer = audioContext.createBuffer(1, totalLength, sampleRate);
    const mergedData = mergedBuffer.getChannelData(0);
    let offset = 0;
    
    for (const buf of audioBuffers) {
      const sourceData = buf.getChannelData(0);
      for (let i = 0; i < buf.length; i++) {
        mergedData[offset + i] = sourceData[i];
      }
      offset += buf.length;
    }
    
    // Encode to WAV
    const wavBlob = audioBufferToWav(mergedBuffer);
    await audioContext.close();
    
    return wavBlob;
  }

  /**
   * Build and load merged audio for playback
   */
  async buildPlayback(): Promise<boolean> {
    if (this.segments.length === 0) return false;
    
    // If already built and no changes, reuse
    if (this.mergedUrl && this.audio.src === this.mergedUrl) {
      return true;
    }
    
    const blob = await this.getMergedBlob();
    if (!blob) return false;
    
    if (this.mergedUrl) {
      URL.revokeObjectURL(this.mergedUrl);
    }
    
    this.mergedUrl = URL.createObjectURL(blob);
    this.audio.src = this.mergedUrl;
    
    await this.waitForReady();
    return true;
  }

  /**
   * Start or resume playback
   */
  async play(): Promise<void> {
    // Build merged audio if needed
    if (!this.mergedUrl && this.segments.length > 0) {
      await this.buildPlayback();
    }
    
    if (!this.audio.src) return;
    
    await this.audio.play();
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.audio.pause();
  }

  /**
   * Stop playback and reset to beginning
   */
  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  /**
   * Seek to a specific position in seconds
   */
  seek(position: number): void {
    if (Number.isFinite(position) && position >= 0) {
      this.audio.currentTime = Math.min(position, this.audio.duration || 0);
    }
  }

  /**
   * Get current playback position
   */
  get currentTime(): number {
    return this.audio.currentTime;
  }

  /**
   * Get duration of loaded audio
   */
  get duration(): number {
    return this.audio.duration || 0;
  }

  /**
   * Check if currently playing
   */
  get playing(): boolean {
    return !this.audio.paused;
  }

  /**
   * Check if audio is loaded and ready
   */
  get ready(): boolean {
    return this.audio.readyState >= 3;
  }

  /**
   * Get all segments
   */
  getSegments(): AudioSegment[] {
    return [...this.segments];
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.audio.pause();
    this.audio.src = '';
    if (this.mergedUrl) {
      URL.revokeObjectURL(this.mergedUrl);
      this.mergedUrl = null;
    }
    this.segments = [];
  }

  /**
   * Wait for audio to be ready for playback
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      if (this.audio.readyState >= 3) {
        resolve();
        return;
      }
      
      const onCanPlay = () => {
        this.audio.removeEventListener('canplay', onCanPlay);
        resolve();
      };
      this.audio.addEventListener('canplay', onCanPlay);
    });
  }
}
