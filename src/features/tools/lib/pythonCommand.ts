import { type Command, type CommandContext, defineCommand, type ExecResult } from "just-bash/browser";
import { executeCode } from "./interpreter";
import { runCodeInSandbox } from "./interpreterCommand";
import { decodeStdin } from "./stdin";

const PYODIDE_VERSION = "3.13 (Pyodide)";

async function executePython(args: string[], ctx: CommandContext): Promise<ExecResult> {
  // --version / -V
  if (args.includes("--version") || args.includes("-V")) {
    return { stdout: `Python ${PYODIDE_VERSION}\n`, stderr: "", exitCode: 0 };
  }

  let code: string | undefined;

  // -c "code"
  const cIdx = args.indexOf("-c");
  if (cIdx !== -1) {
    code = args[cIdx + 1];
    if (!code) {
      return { stdout: "", stderr: "python3: option -c requires argument\n", exitCode: 2 };
    }
  }

  // script.py
  if (code === undefined && args.length > 0 && !args[0].startsWith("-")) {
    const scriptPath = args[0].startsWith("/") ? args[0] : `${ctx.cwd}/${args[0]}`;
    try {
      code = (await ctx.fs.readFile(scriptPath, "utf-8")) as string;
    } catch {
      return {
        stdout: "",
        stderr: `python3: can't open file '${args[0]}': [Errno 2] No such file or directory\n`,
        exitCode: 2,
      };
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
      stderr: "python3: no code provided (use -c, a script file, or pipe via stdin)\n",
      exitCode: 2,
    };
  }

  return runCodeInSandbox(ctx, code, executeCode);
}

export const pythonCommands: Command[] = [
  defineCommand("python3", executePython),
  defineCommand("python", executePython),
];
