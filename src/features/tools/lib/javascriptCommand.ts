import { type Command, type CommandContext, defineCommand, type ExecResult } from "just-bash/browser";
import { bytesToDataUrl, dataUrlToBytes } from "@/shared/lib/fileContent";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import { SANDBOX_HOME } from "@/shared/lib/sandbox";
import { executeJavaScript } from "./javascript";
import { decodeStdin } from "./stdin";

// Reported by `node --version`; the sandbox is the browser engine, not Node, but
// the label keeps scripts that probe the runtime from bailing out.
const JS_RUNTIME_VERSION = "v22 (sandboxed Web Worker)";

async function collectFsFiles(ctx: CommandContext): Promise<Record<string, { content: string; contentType?: string }>> {
  const files: Record<string, { content: string; contentType?: string }> = {};

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

async function syncResultFiles(
  ctx: CommandContext,
  resultFiles: Record<string, { content: string; contentType?: string }>,
) {
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
      return {
        stdout: "",
        stderr: `node: cannot find module '${args[0]}'\n`,
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
      stderr: "node: no code provided (use -e, a script file, or pipe via stdin)\n",
      exitCode: 2,
    };
  }

  try {
    const files = await collectFsFiles(ctx);
    const result = await executeJavaScript({ code, files });

    if (result.files) {
      await syncResultFiles(ctx, result.files);

      // Propagate deletions: a file that existed before the run but is absent
      // from the result snapshot was removed by the JS code.
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

    const output = result.output === "Code executed successfully (no output)" ? "" : result.output;
    return { stdout: output ? `${output}\n` : "", stderr: "", exitCode: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `${message}\n`, exitCode: 1 };
  }
}

export const javascriptCommands: Command[] = [defineCommand("node", executeNode), defineCommand("js", executeNode)];
