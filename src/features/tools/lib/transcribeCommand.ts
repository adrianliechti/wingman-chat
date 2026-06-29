import { getConfig } from "@/shared/config";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import { getFileName } from "@/shared/lib/utils";
import { resolveModel } from "./commandUtils";
import { extractAudioForTranscription } from "./extractAudio";

export async function runTranscribe(bytes: Uint8Array, path: string): Promise<string> {
  const config = getConfig();
  if (!config.stt) {
    throw new Error("transcribe: no transcription service configured");
  }
  if (bytes.length === 0) {
    throw new Error(`transcribe: file is empty: ${path}`);
  }

  const name = getFileName(path);
  const type = inferContentTypeFromPath(name);
  // Video containers are accepted too — voice memos and screen recordings
  // commonly arrive as .mp4/.webm, and transcription backends handle them.
  if (!type || !(type.startsWith("audio/") || type.startsWith("video/"))) {
    throw new Error(`transcribe: not an audio file: ${name} — use a known audio extension like .mp3 or .wav`);
  }

  const model = await resolveModel(config.stt.model, "transcriber");

  // Video containers carry a large video track around a small audio one. Strip
  // the video and re-encode the audio to a compact file in the browser so long
  // recordings stay under the endpoint's upload limit; audio files upload as-is.
  let audio: Blob;
  if (type.startsWith("video/")) {
    try {
      audio = await extractAudioForTranscription(bytes, type, config.stt.format);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`transcribe: ${message}: ${name}`);
    }
  } else {
    audio = new Blob([bytes as BlobPart], { type });
  }

  const text = await config.client.transcribe(model, audio);
  console.debug(
    `transcribe: ${path} (${type}, ${bytes.length} bytes → ${audio.type}, ${audio.size} bytes) → ${text.length} chars`,
  );
  return text;
}
