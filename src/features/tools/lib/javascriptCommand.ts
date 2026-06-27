import { type Command, type CommandContext, defineCommand, type ExecResult } from "just-bash/browser";
import { runCodeInSandbox } from "./interpreterCommand";
import { executeJavaScript } from "./javascript";
import { decodeStdin } from "./stdin";

// Reported by `node --version`; the sandbox is the browser engine, not Node, but
// the label keeps scripts that probe the runtime from bailing out.
const JS_RUNTIME_VERSION = "v22 (sandboxed Web Worker)";

async function executeNode(args: string[], ctx: CommandContext): Promise<ExecResult> {
  // --version / -v
  if (args.includes("--version") || args.includes("-v")) {
    return { stdout: `${JS_RUNTIME_VERSION}\n`, stderr: "", exitCode: 0 };
  }

  let code: string | undefined;

  // -e "code" (also --eval)
  const eIdx = args.findIndex((a) => a === "-e" || a === "--eval");
  if (eIdx !== -1) {
    code = args[eIdx + 1];
    if (!code) {
      return { stdout: "", stderr: "node: option -e requires argument\n", exitCode: 2 };
    }
  }

  // script.js
  if (code === undefined && args.length > 0 && !args[0].startsWith("-")) {
    const scriptPath = args[0].startsWith("/") ? args[0] : `${ctx.cwd}/${args[0]}`;
    try {
      code = (await ctx.fs.readFile(scriptPath, "utf-8")) as string;
    } catch {
      return { stdout: "", stderr: `node: cannot find module '${args[0]}'\n`, exitCode: 2 };
    }
  }

  // stdin
  if (code === undefined) {
    const stdinText = decodeStdin(ctx.stdin);
    if (stdinText) {
      code = stdinText;
    }
  }

  // no input at all
  if (code === undefined) {
    return {
      stdout: "",
      stderr: "node: no code provided (use -e, a script file, or pipe via stdin)\n",
      exitCode: 2,
    };
  }

  return runCodeInSandbox(ctx, code, executeJavaScript);
}

export const javascriptCommands: Command[] = [defineCommand("node", executeNode), defineCommand("js", executeNode)];
