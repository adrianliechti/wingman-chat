import { getConfig } from "@/shared/config";
import { resolveModel } from "./commandUtils";

export async function runSynthesize(text: string, voice?: string): Promise<Uint8Array> {
  const config = getConfig();
  if (!config.tts) {
    throw new Error("synthesize: no speech synthesis service configured");
  }
  if (!text.trim()) {
    throw new Error("synthesize: no text provided");
  }

  // Logical speaker names from the config (e.g. "narrator") resolve to voice ids.
  const resolvedVoice = voice ? (config.tts.voices?.[voice] ?? voice) : undefined;
  const model = await resolveModel(config.tts.model, "synthesizer");
  const blob = await config.client.generateAudio(model, text, resolvedVoice);
  const data = new Uint8Array(await blob.arrayBuffer());
  if (data.length === 0) {
    throw new Error("synthesize: service returned empty audio");
  }
  console.debug(`synthesize: ${text.length} chars → ${data.length} bytes (wav)`);
  return data;
}
