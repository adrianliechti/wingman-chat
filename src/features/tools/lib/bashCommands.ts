import { defineCommand, type Command, type ExecResult, type ResolvedCommandContext } from "just-bash/browser";
import type { LlmCallOptions } from "./interpreterProtocol";

export interface BashServices {
  ocr(data: Uint8Array, path: string, signal?: AbortSignal): Promise<string>;
  llm(prompt: string, options: LlmCallOptions, signal?: AbortSignal): Promise<string>;
}

const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const OUTPUT_FLAGS = { "-o": "output", "--output": "output" };
const LLM_FLAGS = {
  ...OUTPUT_FLAGS,
  "-m": "model",
  "--model": "model",
  "-s": "system",
  "--system": "system",
  "-e": "effort",
  "--effort": "effort",
};

function parseArgs(args: string[], flags: Record<string, string>) {
  const options = new Map<string, string>();
  const rest: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      rest.push(...args.slice(index + 1));
      break;
    }
    if (Object.hasOwn(flags, arg)) {
      const value = args[++index];
      if (value === undefined) throw new Error(`option ${arg} requires an argument`);
      options.set(flags[arg], value);
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}; use -- before a filename or prompt starting with '-'`);
    } else {
      rest.push(arg);
    }
  }
  return { options, rest };
}

function failure(name: string, error: unknown, exitCode = 1): ExecResult {
  return { stdout: "", stderr: `${name}: ${error instanceof Error ? error.message : String(error)}\n`, exitCode };
}

async function textResult(text: string, output: string | undefined, ctx: ResolvedCommandContext): Promise<ExecResult> {
  ctx.signal?.throwIfAborted();
  if (output !== undefined) {
    if (!output) throw new Error("output path must not be empty");
    const path = ctx.fs.resolvePath(ctx.cwd, output);
    await ctx.fs.mkdir(path.slice(0, path.lastIndexOf("/")) || "/", { recursive: true });
    await ctx.fs.writeFile(path, text);
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  // The explicit kind keeps Unicode intact through just-bash's byte-oriented pipes.
  return { stdout: text.endsWith("\n") ? text : `${text}\n`, stdoutKind: "text", stderr: "", exitCode: 0 };
}

export function createBashCommands(services: BashServices): Command[] {
  const extraction = ["ocr", "extract"].map((name) =>
    defineCommand(name, async (args, ctx) => {
      const usage = `usage: ${name} [-o output.txt] <file>`;
      if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
        return { stdout: `${usage}\n`, stderr: "", exitCode: 0 };
      }
      let parsed: ReturnType<typeof parseArgs>;
      try {
        parsed = parseArgs(args, OUTPUT_FLAGS);
        if (parsed.rest.length !== 1) throw new Error(usage);
      } catch (error) {
        return failure(name, error, 2);
      }
      try {
        const path = ctx.fs.resolvePath(ctx.cwd, parsed.rest[0]);
        const bytes = await ctx.fs.readFileBuffer(path);
        const text = await services.ocr(bytes, path, ctx.signal);
        return await textResult(text, parsed.options.get("output"), ctx);
      } catch (error) {
        return failure(name, error);
      }
    }),
  );

  const llm = defineCommand("llm", async (args, ctx) => {
    const usage = "usage: llm [-m model] [-s system] [-e effort] [-o output.txt] [prompt] (accepts piped text)";
    if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
      return { stdout: `${usage}\n`, stderr: "", exitCode: 0 };
    }
    let parsed: ReturnType<typeof parseArgs>;
    let prompt: string;
    try {
      parsed = parseArgs(args, LLM_FLAGS);
      const effort = parsed.options.get("effort");
      if (effort !== undefined && !EFFORTS.has(effort))
        throw new Error(`--effort requires one of: ${[...EFFORTS].join(", ")}`);
      // stdin is a latin1 byte string, not a JavaScript Unicode string.
      const stdin = new TextDecoder().decode(
        Uint8Array.from(ctx.stdin as unknown as string, (char) => char.charCodeAt(0)),
      );
      prompt = [parsed.rest.join(" "), stdin].filter(Boolean).join("\n\n");
      if (!prompt.trim()) throw new Error(usage);
    } catch (error) {
      return failure("llm", error, 2);
    }
    try {
      const options: LlmCallOptions = {
        model: parsed.options.get("model"),
        system: parsed.options.get("system"),
        effort: parsed.options.get("effort") as LlmCallOptions["effort"],
      };
      const text = await services.llm(prompt, options, ctx.signal);
      return await textResult(text, parsed.options.get("output"), ctx);
    } catch (error) {
      return failure("llm", error);
    }
  });
  return [...extraction, llm];
}
