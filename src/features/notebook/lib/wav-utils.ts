/**
 * Merge multiple PCM WAV blobs into a single WAV blob.
 * Assumes all blobs share the same sample rate, channel count, and bit depth.
 */
export async function mergeWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];

  const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));

  // Walk the RIFF chunk list instead of assuming a fixed 44-byte header —
  // encoders may emit extra chunks (LIST, fact, ...) before fmt/data, which
  // would otherwise splice header bytes into the merged audio.
  const parsed = buffers.map(parseWav);
  const { numChannels, sampleRate, bitsPerSample } = parsed[0];

  // Raw PCM concatenation is only valid when every segment shares one format —
  // a mismatched segment would play stretched/garbled, so fail instead.
  for (const info of parsed) {
    if (info.numChannels !== numChannels || info.sampleRate !== sampleRate || info.bitsPerSample !== bitsPerSample) {
      throw new Error("Cannot merge WAV segments with mismatched audio formats");
    }
  }

  const pcmChunks: ArrayBuffer[] = [];
  let totalDataSize = 0;
  for (let i = 0; i < buffers.length; i++) {
    const chunk = buffers[i].slice(parsed[i].dataOffset, parsed[i].dataOffset + parsed[i].dataSize);
    pcmChunks.push(chunk);
    totalDataSize += chunk.byteLength;
  }

  const headerSize = 44;
  const result = new ArrayBuffer(headerSize + totalDataSize);
  const view = new DataView(result);
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + totalDataSize, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, totalDataSize, true);

  const output = new Uint8Array(result);
  let offset = headerSize;
  for (const chunk of pcmChunks) {
    output.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return new Blob([result], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

interface WavInfo {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
}

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Locate the fmt and data chunks of a RIFF/WAVE buffer. Throws on malformed input. */
function parseWav(buf: ArrayBuffer): WavInfo {
  const view = new DataView(buf);
  if (buf.byteLength < 12 || readTag(view, 0) !== "RIFF" || readTag(view, 8) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }

  let fmt: Pick<WavInfo, "numChannels" | "sampleRate" | "bitsPerSample"> | null = null;
  let data: Pick<WavInfo, "dataOffset" | "dataSize"> | null = null;

  let pos = 12;
  while (pos + 8 <= view.byteLength) {
    const id = readTag(view, pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;

    if (id === "fmt " && body + 16 <= view.byteLength) {
      fmt = {
        numChannels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      // Clamp to the buffer — a streaming encoder may have written a
      // placeholder size larger than the actual payload.
      data = { dataOffset: body, dataSize: Math.min(size, view.byteLength - body) };
    }

    // Chunks are word-aligned: odd sizes are followed by a pad byte.
    pos = body + size + (size % 2);
  }

  if (!fmt || !data) {
    throw new Error("Malformed WAV: missing fmt or data chunk");
  }
  return { ...fmt, ...data };
}
