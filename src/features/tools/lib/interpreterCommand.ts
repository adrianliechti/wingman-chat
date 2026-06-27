/**
 * Shared filesystem bridge for the interpreter shell commands (`python3`/`python`
 * and `node`/`js`).
 *
 * Both commands do the same thing around their interpreter: snapshot every file
 * under the sandbox home into an artifact map, run the code against it, write the
 * results back, and propagate deletions. Only the interpreter they call differs,
 * so that one function is passed in.
 */

import type { CommandContext, ExecResult } from "just-bash/browser";
import { bytesToDataUrl, dataUrlToBytes } from "@/shared/lib/fileContent";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import { SANDBOX_HOME } from "@/shared/lib/sandbox";
import type { CodeExecutionRequest, CodeExecutionResult } from "./interpreterProtocol";

export type SandboxCommandFiles = Record<string, { content: string; contentType?: string }>;

// Kept in sync with the workers' own "no output" sentinel so a silent run maps
// back to empty stdout rather than leaking the placeholder text into the shell.
const NO_OUTPUT_MESSAGE = "Code executed successfully (no output)";

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
 * Snapshot the command's files, run `code` through `execute`, then write the
 * results back to the command filesystem and propagate deletions. Both
 * interpreters share one artifact filesystem this way, so files created by one
 * command are visible to the others on subsequent runs.
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

      // Propagate deletions: a file that existed before the run but is absent
      // from the result snapshot was removed by the code — without this it would
      // survive in the command FS and get resurrected on sync-back.
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
