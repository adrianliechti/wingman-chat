import { type Command, type CommandContext, defineCommand, type ExecResult } from "just-bash/browser";
import { getConfig } from "@/shared/config";
import type { ModelType } from "@/shared/types/chat";

// Cache per model type — the backend's model list doesn't change within a session.
const resolvedModels = new Map<ModelType, Promise<string>>();

/**
 * Resolve the model for a helper: the configured id when set, otherwise the
 * first backend model of the given type (e.g. "synthesizer" for TTS). Returns
 * "" when the backend lists none — callers pass that through and let the
 * backend apply its own default.
 */
export function resolveModel(configured: string | undefined, type: ModelType): Promise<string> {
  if (configured) return Promise.resolve(configured);
  let pending = resolvedModels.get(type);
  if (!pending) {
    pending = getConfig()
      .client.listModels(type)
      .then((models) => models[0]?.id ?? "");
    // Drop failed lookups so a transient network error doesn't stick for the session.
    pending.catch(() => resolvedModels.delete(type));
    resolvedModels.set(type, pending);
  }
  return pending;
}

/** Resolve a command-line path argument against the shell's working directory. */
export function resolvePath(path: string, cwd: string): string {
  return path.startsWith("/") ? path : `${cwd}/${path}`;
}

/** Write a command's output file, creating parent directories as needed. */
export async function writeOutputFile(
  fs: CommandContext["fs"],
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (dir) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // exists
    }
  }
  await fs.writeFile(path, content);
}

/**
 * Parse `-f value` style flags. `spec` maps each flag alias to a canonical
 * option name; values of repeated flags accumulate in order (callers take
 * `.at(-1)` for single-value options, matching getopt's last-one-wins).
 * Unrecognized arguments are returned as positionals in `rest`.
 */
export function parseFlags(
  command: string,
  args: string[],
  spec: Record<string, string>,
): { options: Partial<Record<string, string[]>>; rest: string[]; error?: string } {
  const options: Partial<Record<string, string[]>> = {};
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const key = spec[arg];
    if (key) {
      const value = args[++i];
      if (!value) return { options, rest, error: `${command}: option ${arg} requires an argument` };
      const values = options[key] ?? [];
      values.push(value);
      options[key] = values;
    } else {
      rest.push(arg);
    }
  }

  return { options, rest };
}

/**
 * Build a bash command for helpers shaped "read one file, return text"
 * (ocr, vision, transcribe): parses `[-o output] <file> [prompt...]`, reads
 * the file as binary, delegates to `run`, and prints the text to stdout —
 * or writes it to the `-o/--output` file instead.
 */
export function defineFileToTextCommand(opts: {
  name: string;
  usage: string;
  /** Treat positional args after the file as a prompt passed to `run`. */
  acceptsPrompt?: boolean;
  run: (bytes: Uint8Array, path: string, prompt?: string) => Promise<string>;
}): Command {
  return defineCommand(opts.name, async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
    const { options, rest, error } = parseFlags(opts.name, args, { "-o": "output", "--output": "output" });
    if (error) {
      return { stdout: "", stderr: `${error}\n`, exitCode: 2 };
    }
    if (opts.acceptsPrompt ? rest.length === 0 : rest.length !== 1) {
      return { stdout: "", stderr: `${opts.usage}\n`, exitCode: 2 };
    }
    const output = options.output?.at(-1);
    const prompt = opts.acceptsPrompt ? rest.slice(1).join(" ").trim() || undefined : undefined;

    const fsPath = resolvePath(rest[0], ctx.cwd);
    let bytes: Uint8Array;
    try {
      // readFileBuffer, not readFile — the latter decodes to a UTF-8 string,
      // which destroys binary formats like PDF, images, and audio.
      bytes = await ctx.fs.readFileBuffer(fsPath);
    } catch {
      return { stdout: "", stderr: `${opts.name}: cannot read file: ${rest[0]}\n`, exitCode: 1 };
    }

    try {
      const text = await opts.run(bytes, fsPath, prompt);

      if (output) {
        await writeOutputFile(ctx.fs, resolvePath(output, ctx.cwd), text);
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      return { stdout: text.endsWith("\n") ? text : `${text}\n`, stderr: "", exitCode: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { stdout: "", stderr: `${message}\n`, exitCode: 1 };
    }
  });
}
