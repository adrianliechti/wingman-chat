import type { OutputFormat } from "mediabunny";
import type { STTFormat } from "@/shared/config";

// Pulls the audio track out of a media file (typically a video container) and
// re-encodes it to a small, speech-optimized audio file for transcription.
//
// Video containers wrap a large video track around a comparatively tiny audio
// track — uploading the whole file to a speech-to-text endpoint wastes
// bandwidth and blows through size limits (OpenAI's Whisper caps at 25 MB,
// ~13 min of WAV). Extracting just the audio, downmixed to mono 16 kHz, keeps
// even hour-long recordings well under that.
//
// Runs entirely in the browser via mediabunny (WebCodecs) — no ffmpeg.wasm, no
// cross-origin-isolation headers, no server round trip. Imported lazily so the
// library only loads the first time someone transcribes a video.

// 16 kHz mono is what speech models expect; higher rates/channels only inflate
// the upload without improving transcription.
const TARGET_SAMPLE_RATE = 16000;
const TARGET_CHANNELS = 1;
// ~32 kbps is transparent for mono speech in either Opus or AAC (~14 MB/hour).
const COMPRESSED_BITRATE = 32000;

/**
 * Decode the audio track from `bytes` (a media file of `sourceType`) and return
 * a compact audio Blob ready to send to the transcription endpoint.
 *
 * `format` selects the container/codec (default `opus` — Opus in Ogg, the
 * smallest broadly-accepted form). Compressed formats need a WebCodecs encoder
 * (Opus is broad; AAC is absent on Firefox) and fall back to WAV — pure-JS PCM,
 * always available — so the result is always something the backend can read. The
 * Blob's MIME type is chosen so its extension is one the backend accepts
 * (client.transcribe maps ogg/webm/mp4/wav to .ogg/.webm/.m4a/.wav).
 *
 * Throws when the file has no decodable audio track.
 */
export async function extractAudioForTranscription(
  bytes: Uint8Array,
  sourceType: string,
  format: STTFormat = "opus",
): Promise<Blob> {
  const {
    Input,
    Output,
    Conversion,
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    OggOutputFormat,
    WebMOutputFormat,
    Mp4OutputFormat,
    WavOutputFormat,
    canEncodeAudio,
  } = await import("mediabunny");

  type Spec = { Format: new () => OutputFormat; codec?: "opus" | "aac"; mime: string };
  const specs: Record<STTFormat, Spec> = {
    opus: { Format: OggOutputFormat, codec: "opus", mime: "audio/ogg" },
    webm: { Format: WebMOutputFormat, codec: "opus", mime: "audio/webm" },
    mp4: { Format: Mp4OutputFormat, codec: "aac", mime: "audio/mp4" },
    wav: { Format: WavOutputFormat, mime: "audio/wav" },
  };

  let spec = specs[format] ?? specs.opus;
  if (spec.codec && !(await canEncodeAudio(spec.codec))) {
    spec = specs.wav;
  }

  const input = new Input({
    source: new BlobSource(new Blob([bytes as BlobPart], { type: sourceType })),
    formats: ALL_FORMATS,
  });
  const output = new Output({ format: new spec.Format(), target: new BufferTarget() });

  const conversion = await Conversion.init({
    input,
    output,
    video: { discard: true },
    audio: {
      numberOfChannels: TARGET_CHANNELS,
      sampleRate: TARGET_SAMPLE_RATE,
      ...(spec.codec ? { codec: spec.codec, bitrate: COMPRESSED_BITRATE } : {}),
    },
  });

  if (!conversion.isValid) {
    const reason = conversion.discardedTracks.map((t) => t.reason).join(", ") || "no decodable audio track";
    throw new Error(`could not extract audio (${reason})`);
  }

  await conversion.execute();

  const buffer = output.target.buffer;
  if (!buffer) {
    throw new Error("audio extraction produced no output");
  }

  return new Blob([buffer], { type: spec.mime });
}
