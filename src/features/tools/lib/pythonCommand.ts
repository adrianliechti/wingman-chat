import { defineCommand } from "just-bash/browser";
import type { Command, CommandContext, ExecResult } from "just-bash/browser";
import { executeCode } from "./interpreter";
import { SANDBOX_HOME, bytesToDataUrl, dataUrlToBytes } from "@/shared/lib/artifactFiles";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";

const PYODIDE_VERSION = "3.13 (Pyodide)";

async function collectFsFiles(ctx: CommandContext): Promise<Record<string, { content: string; contentType?: string }>> {
  const files: Record<string, { content: string; contentType?: string }> = {};

  const walk = async (dir: string) => {
    let entries: string[];
    try {
      const listing = await ctx.fs.readdir(dir);
      entries = listing.map((e) => (typeof e === "string" ? e : e.name));
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
          const artifactPath = "/" + fullPath.slice(SANDBOX_HOME.length + 1);
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

async function syncResultFiles(ctx: CommandContext, resultFiles: Record<string, { content: string; contentType?: string }>) {
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
      return { stdout: "", stderr: `python3: can't open file '${args[0]}': [Errno 2] No such file or directory\n`, exitCode: 2 };
    }
  }

  // stdin
  if (code === undefined && ctx.stdin) {
    code = ctx.stdin;
  }

  // no input at all
  if (code === undefined) {
    return { stdout: "", stderr: "python3: no code provided (use -c, a script file, or pipe via stdin)\n", exitCode: 2 };
  }

  try {
    const files = await collectFsFiles(ctx);
    const result = await executeCode({ code, files });

    if (result.files) {
      await syncResultFiles(ctx, result.files);
    }

    if (!result.success) {
      return { stdout: "", stderr: result.error || "Unknown error\n", exitCode: 1 };
    }

    const output = result.output === "Code executed successfully (no output)" ? "" : result.output;
    return { stdout: output ? output + "\n" : "", stderr: "", exitCode: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `${message}\n`, exitCode: 1 };
  }
}

export const pythonCommands: Command[] = [
  defineCommand("python3", executePython),
  defineCommand("python", executePython),
];
