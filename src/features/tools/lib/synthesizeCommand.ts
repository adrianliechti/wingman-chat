import { type Command, type CommandContext, defineCommand, type ExecResult } from "just-bash/browser";
import { getConfig } from "@/shared/config";
import { parseFlags, resolveModel, resolvePath, writeOutputFile } from "./commandUtils";
import { decodeStdin } from "./stdin";

const SYNTHESIZE_FLAGS = { "-o": "output", "--output": "output", "-v": "voice", "--voice": "voice" };

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

async function executeSynthesize(args: string[], ctx: CommandContext): Promise<ExecResult> {
  const { options, rest, error } = parseFlags("synthesize", args, SYNTHESIZE_FLAGS);
  if (error) {
    return { stdout: "", stderr: `${error}\n`, exitCode: 2 };
  }

  const output = options.output?.at(-1);
  if (!output) {
    return { stdout: "", stderr: 'usage: synthesize [-v voice] -o output.wav "text"\n', exitCode: 2 };
  }
  const voice = options.voice?.at(-1);

  const text = rest.join(" ").trim() || decodeStdin(ctx.stdin);
  if (!text) {
    return { stdout: "", stderr: "synthesize: no text provided (pass as args or pipe via stdin)\n", exitCode: 2 };
  }

  try {
    const data = await runSynthesize(text, voice);
    await writeOutputFile(ctx.fs, resolvePath(output, ctx.cwd), data);
    return { stdout: "", stderr: "", exitCode: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `${message}\n`, exitCode: 1 };
  }
}

export const synthesizeCommands: Command[] = [defineCommand("synthesize", executeSynthesize)];
