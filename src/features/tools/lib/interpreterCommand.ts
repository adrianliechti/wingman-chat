/**
 * Shared filesystem bridge for the interpreter shell commands (`python3`/`python`
 * and `node`/`js`): snapshot the sandbox home into an artifact map, run the code,
 * write results back, and propagate deletions. Only the interpreter differs.
 */

import { type Command, type CommandContext, defineCommand, type ExecResult } from "just-bash/browser";
import { bytesToDataUrl, dataUrlToBytes } from "@/shared/lib/fileContent";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import { SANDBOX_HOME } from "@/shared/lib/sandbox";
import { type CodeExecutionRequest, type CodeExecutionResult, NO_OUTPUT_MESSAGE } from "./interpreterProtocol";
import { decodeStdin } from "./stdin";

export type SandboxCommandFiles = Record<string, { content: string; contentType?: string }>;

async function collectSandboxFiles(ctx: CommandContext): Promise<SandboxCommandFiles> {
  const files: SandboxCommandFiles = {};

  const walk = async (dir: string) => {
    let entries: string[];
    try {
      entries = await ctx.fs.readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry === "." || entry === "..") continue;
      const fullPath = `${dir}/${entry}`;

      try {
        const stat = await ctx.fs.stat(fullPath);
        if (stat.isDirectory) {
          await walk(fullPath);
        } else if (stat.isFile) {
          const artifactPath = `/${fullPath.slice(SANDBOX_HOME.length + 1)}`;
          const contentType = inferContentTypeFromPath(artifactPath);

          if (isTextContentType(contentType)) {
            const content = await ctx.fs.readFile(fullPath, "utf-8");
            files[artifactPath] = { content: content as string, contentType };
          } else {
            const bytes = await ctx.fs.readFile(fullPath);
            const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
            const mimeType = contentType ?? "application/octet-stream";
            files[artifactPath] = { content: bytesToDataUrl(raw, mimeType), contentType: mimeType };
          }
        }
      } catch {
        // skip unreadable
      }
    }
  };

  await walk(SANDBOX_HOME);
  return files;
}

async function syncResultFiles(ctx: CommandContext, resultFiles: SandboxCommandFiles): Promise<void> {
  for (const [path, file] of Object.entries(resultFiles)) {
    const fsPath = `${SANDBOX_HOME}/${path.startsWith("/") ? path.slice(1) : path}`;

    const dir = fsPath.substring(0, fsPath.lastIndexOf("/"));
    if (dir) {
      try {
        await ctx.fs.mkdir(dir, { recursive: true });
      } catch {
        // exists
      }
    }

    const parsed = dataUrlToBytes(file.content);
    if (parsed) {
      await ctx.fs.writeFile(fsPath, parsed.bytes);
    } else {
      await ctx.fs.writeFile(fsPath, file.content);
    }
  }
}

/**
 * Snapshot the command's files, run `code` through `execute`, write results back,
 * and propagate deletions. Both interpreters share one artifact filesystem, so
 * files created by one command are visible to the others on later runs.
 */
export async function runCodeInSandbox(
  ctx: CommandContext,
  code: string,
  execute: (request: CodeExecutionRequest) => Promise<CodeExecutionResult>,
): Promise<ExecResult> {
  try {
    const files = await collectSandboxFiles(ctx);
    const result = await execute({ code, files });

    if (result.files) {
      await syncResultFiles(ctx, result.files);

      // A file present before the run but absent from the result was deleted by
      // the code; without this it would survive in the command FS.
      for (const path of Object.keys(files)) {
        if (path in result.files) continue;
        try {
          await ctx.fs.rm(`${SANDBOX_HOME}${path}`, { force: true });
        } catch {
          // best effort
        }
      }
    }

    if (!result.success) {
      return { stdout: "", stderr: result.error || "Unknown error\n", exitCode: 1 };
    }

    const output = result.output === NO_OUTPUT_MESSAGE ? "" : result.output;
    return { stdout: output ? `${output}\n` : "", stderr: "", exitCode: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `${message}\n`, exitCode: 1 };
  }
}

/** Describes a code-interpreter shell command (e.g. `python`, `node`). */
export interface InterpreterCommandSpec {
  /** Command names/aliases (the first is used in error messages). */
  names: string[];
  /** Flags that print `versionOutput` and exit, e.g. ["--version", "-V"]. */
  versionFlags: string[];
  versionOutput: string;
  /** Flags that take inline code, e.g. ["-c"] or ["-e", "--eval"]. */
  codeFlags: string[];
  /** stderr when a script-file argument can't be read. */
  notFound: (arg: string) => string;
  /** stderr when no code is provided by any means. */
  noCode: string;
  execute: (request: CodeExecutionRequest) => Promise<CodeExecutionResult>;
}

/**
 * Build the bash commands for a code interpreter: resolve code from `-c`/`-e`,
 * a script-file argument, or piped stdin, then run it through the sandbox.
 * Only the labels, flags, and executor differ between interpreters.
 */
export function createInterpreterCommand(spec: InterpreterCommandSpec): Command[] {
  const run = async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
    if (args.some((arg) => spec.versionFlags.includes(arg))) {
      return { stdout: `${spec.versionOutput}\n`, stderr: "", exitCode: 0 };
    }

    let code: string | undefined;

    const flagIdx = args.findIndex((arg) => spec.codeFlags.includes(arg));
    if (flagIdx !== -1) {
      code = args[flagIdx + 1];
      if (!code) {
        return { stdout: "", stderr: `${spec.names[0]}: option ${args[flagIdx]} requires argument\n`, exitCode: 2 };
      }
    }

    if (code === undefined && args.length > 0 && !args[0].startsWith("-")) {
      const scriptPath = args[0].startsWith("/") ? args[0] : `${ctx.cwd}/${args[0]}`;
      try {
        code = (await ctx.fs.readFile(scriptPath, "utf-8")) as string;
      } catch {
        return { stdout: "", stderr: spec.notFound(args[0]), exitCode: 2 };
      }
    }

    if (code === undefined) {
      code = decodeStdin(ctx.stdin) || undefined;
    }

    if (code === undefined) {
      return { stdout: "", stderr: spec.noCode, exitCode: 2 };
    }

    return runCodeInSandbox(ctx, code, spec.execute);
  };

  return spec.names.map((name) => defineCommand(name, run));
}
