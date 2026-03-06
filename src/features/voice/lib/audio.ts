/**
 * Audio format utilities - PCM16 and WAV encoding/decoding
 */

/**
 * Convert Float32 audio samples (-1 to 1) to PCM16 Int16Array
 */
export function float32ToPcm16(samples: Float32Array): Int16Array {
  const pcm16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm16;
}

/**
 * Convert PCM16 Int16Array to WAV Blob
 */
export function pcm16ToWav(samples: Int16Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitDepth = 16;
  const dataLength = samples.length * (bitDepth / 8);
  const headerLength = 44;
  const totalLength = headerLength + dataLength;

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true); // byte rate
  view.setUint16(32, numChannels * (bitDepth / 8), true); // block align
  view.setUint16(34, bitDepth, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(offset, samples[i], true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Convert Float32 audio samples to WAV Blob
 */
export function float32ToWav(samples: Float32Array, sampleRate: number): Blob {
  return pcm16ToWav(float32ToPcm16(samples), sampleRate);
}

/**
 * Convert AudioBuffer to WAV Blob (mono, uses first channel)
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  return float32ToWav(buffer.getChannelData(0), buffer.sampleRate);
}

/**
 * Merge multiple PCM16 chunks into a single Int16Array
 */
export function mergePcm16Chunks(chunks: Int16Array[]): Int16Array {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
  }

  const merged = new Int16Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

/**
 * Calculate duration in seconds from PCM16 sample count
 */
export function pcm16Duration(sampleCount: number, sampleRate: number): number {
  return sampleCount / sampleRate;
}

// Helper to write ASCII string to DataView
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
