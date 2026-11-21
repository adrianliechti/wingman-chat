import { defineCommand, type Command, type ExecResult, type ResolvedCommandContext } from "just-bash/browser";
import { bridgeInputPaths, bridgeOutputPath } from "./bridgePaths";
import type { LlmCallOptions } from "./interpreterProtocol";
import type { scriptToolClient } from "./interpreterRpc";

export interface BashServices {
  ocr(data: Uint8Array, path: string, signal?: AbortSignal): Promise<string>;
  llm(prompt: string, options: LlmCallOptions, signal?: AbortSignal): Promise<string>;
  tools: ReturnType<typeof scriptToolClient>;
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

function stdinText(ctx: ResolvedCommandContext): string {
  // just-bash passes a latin1 byte string through pipes.
  return new TextDecoder().decode(Uint8Array.from(ctx.stdin as unknown as string, (char) => char.charCodeAt(0)));
}

async function prepareOutput(output: string | undefined, ctx: ResolvedCommandContext): Promise<string | undefined> {
  if (output === undefined) return;
  const path = bridgeOutputPath(output, ctx.cwd);
  if ((await ctx.fs.exists(path)) && (await ctx.fs.stat(path)).isDirectory) {
    throw new Error(`Output path is a directory: ${path}`);
  }
  await ctx.fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  return path;
}

async function textResult(text: string, output: string | undefined, ctx: ResolvedCommandContext): Promise<ExecResult> {
  ctx.signal?.throwIfAborted();
  if (output !== undefined) {
    await ctx.fs.writeFile(output, text);
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
        const input = parsed.rest[0];
        for (const path of bridgeInputPaths(input, ctx.cwd)) {
          if (!(await ctx.fs.exists(path))) continue;
          const bytes = await ctx.fs.readFileBuffer(path);
          const output = await prepareOutput(parsed.options.get("output"), ctx);
          const text = await services.ocr(bytes, path, ctx.signal);
          return await textResult(text, output, ctx);
        }
        throw new Error(`cannot read file: ${input}`);
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
      prompt = [parsed.rest.join(" "), stdinText(ctx)].filter(Boolean).join("\n\n");
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
      const output = await prepareOutput(parsed.options.get("output"), ctx);
      const text = await services.llm(prompt, options, ctx.signal);
      return await textResult(text, output, ctx);
    } catch (error) {
      return failure("llm", error);
    }
  });

  const tools = defineCommand("tools", async (args, ctx) => {
    const usage = "usage: tools list | tools call NAME [JSON object] (also accepts JSON on stdin)";
    try {
      ctx.signal?.throwIfAborted();
      let value: unknown;
      if (args.length === 1 && args[0] === "list") {
        value = await services.tools.list();
      } else if (args[0] === "call" && args[1] && args.length <= 3) {
        const input = args[2] ?? stdinText(ctx);
        value = await services.tools.call(args[1], input.trim() ? JSON.parse(input) : {});
      } else {
        return failure("tools", usage, 2);
      }
      return await textResult(typeof value === "string" ? value : JSON.stringify(value), undefined, ctx);
    } catch (error) {
      return failure("tools", error);
    }
  });
  return [...extraction, llm, tools];
}
