import { getConfig } from "@/shared/config";
import { resolveModel } from "@/shared/lib/modelSelection";

export async function runSynthesize(
  text: string,
  voice?: string,
  requestOptions: { signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  requestOptions.signal?.throwIfAborted();
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
  requestOptions.signal?.throwIfAborted();
  const blob = await config.client.generateAudio(model, text, resolvedVoice, requestOptions);
  const data = new Uint8Array(await blob.arrayBuffer());
  requestOptions.signal?.throwIfAborted();
  if (data.length === 0) {
    throw new Error("synthesize: service returned empty audio");
  }
  console.debug(`synthesize: ${text.length} chars → ${data.length} bytes (wav)`);
  return data;
}
