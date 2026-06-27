/**
 * Execution tools (Python + Bash) for notebooks. Mirrors the artifact chat's
 * execute tools, but with notebook sources as the filesystem root.
 *
 * Symmetric mapping: notebook source `data.csv` ↔ sandbox `/home/user/data.csv`.
 *
 * Deletions are NOT propagated — sources are treated as append-only from code
 * execution (the model should use `source_create` to explicitly replace, and
 * users remove sources through the UI).
 */

import { executeBash, getSingleton, loadArtifactsIntoFs, readFilesFromFs } from "@/features/tools/lib/bash";
import { executeCode } from "@/features/tools/lib/interpreter";
import { executeJavaScript } from "@/features/tools/lib/javascript";
import { withSandboxLock } from "@/features/tools/lib/sandboxLock";
import type { Tool } from "@/shared/types/chat";
import type { File } from "@/shared/types/file";

interface FileRecord {
  content: string;
  contentType?: string;
}

type FileMap = Record<string, FileRecord>;

/**
 * Normalize a path to the notebook-source canonical form (no leading slash).
 * Sandbox runtimes return `/foo.csv` but sources are stored without one; without
 * this, diffing would create duplicate (`foo.csv` / `/foo.csv`) entries every
 * time the sandbox writes a file.
 */
function normalizeSourceKey(path: string): string {
  let p = path.trim();
  while (p.startsWith("/")) p = p.slice(1);
  return p;
}

function normalizeMapKeys(map: FileMap): FileMap {
  const out: FileMap = {};
  for (const [path, rec] of Object.entries(map)) {
    const key = normalizeSourceKey(path);
    if (key) out[key] = rec;
  }
  return out;
}

function sourcesToFileMap(sources: readonly File[]): FileMap {
  const map: FileMap = {};
  for (const s of sources) {
    map[normalizeSourceKey(s.path)] = { content: s.content, contentType: s.contentType };
  }
  return map;
}

/** Diff new vs old file maps; return files that were added or modified. */
function diffWrites(before: FileMap, after: FileMap): FileMap {
  const diff: FileMap = {};
  for (const [path, rec] of Object.entries(after)) {
    const prev = before[path];
    if (!prev || prev.content !== rec.content || prev.contentType !== rec.contentType) {
      diff[path] = rec;
    }
  }
  return diff;
}

export interface SourceExecToolsOptions {
  /**
   * Callback invoked for each file the sandbox added or changed.
   * Path is sandbox-relative (no `/home/user/` prefix).
   */
  onWrite: (path: string, content: string, contentType?: string) => Promise<void>;
}

/**
 * Create execution tools (python + bash) that expose notebook sources as the
 * working filesystem, mounted at `/home/user/` and persisted back via `onWrite`.
 */
export function createSourceExecTools(getSources: () => readonly File[], options: SourceExecToolsOptions): Tool[] {
  const { onWrite } = options;

  async function persistWrites(before: FileMap, after: FileMap): Promise<string[]> {
    const diff = diffWrites(before, after);
    const written: string[] = [];
    for (const [path, rec] of Object.entries(diff)) {
      try {
        await onWrite(path, rec.content, rec.contentType);
        written.push(path);
      } catch {
        // Swallow individual write failures so one bad file doesn't kill the batch.
      }
    }
    return written;
  }

  return [
    {
      name: "execute_python_code",
      description:
        "Execute Python code in a sandboxed Pyodide environment. All notebook sources are available under `/home/user/`, and files created or modified there are saved back as notebook sources. Packages numpy, pandas, matplotlib, seaborn, pillow, openpyxl, pypdf, pdfminer.six, pdfplumber, python-docx, beautifulsoup4, markdownify, tabulate are preloaded. For async code use top-level `await` directly; never call asyncio.run() or loop.run_until_complete() — they cannot block in the browser.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Python code to execute. Use standard I/O under `/home/user/` to read and write files.",
          },
          packages: {
            type: ["array", "null"],
            items: { type: "string" },
            description: "Optional extra Python packages to load (e.g., ['scikit-learn']).",
          },
        },
        required: ["code", "packages"],
        additionalProperties: false,
      },
      function: async (args: Record<string, unknown>) => {
        const code = typeof args.code === "string" ? args.code : "";
        // Coerce defensively: models sometimes send `packages` as a bare string.
        const packages = Array.isArray(args.packages)
          ? args.packages.filter((p): p is string => typeof p === "string")
          : typeof args.packages === "string"
            ? [args.packages]
            : undefined;
        if (!code.trim()) {
          return [{ type: "text" as const, text: "Error: `code` is required." }];
        }

        // Snapshot → execute → persist runs under the sandbox lock so
        // parallel tool calls can't interleave on the shared runtimes.
        return withSandboxLock(async () => {
          const before = sourcesToFileMap(getSources());

          try {
            const result = await executeCode({ code, packages, files: before });

            if (!result.success) {
              return [{ type: "text" as const, text: `Error executing code: ${result.error || "Unknown error"}` }];
            }

            const after = normalizeMapKeys(result.files ?? {});
            const written = await persistWrites(before, after);

            const parts: string[] = [result.output || "(no output)"];
            if (written.length > 0) {
              parts.push(`\nSaved sources: ${written.join(", ")}`);
            }
            return [{ type: "text" as const, text: parts.join("") }];
          } catch (err) {
            return [
              {
                type: "text" as const,
                text: `Python execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
              },
            ];
          }
        });
      },
    },
    {
      name: "execute_javascript_code",
      description:
        "Execute JavaScript in a sandboxed Web Worker (off the UI thread, no network). Read and write notebook sources through the injected `vfs` helper: `vfs.read(path)` / `vfs.readBytes` / `vfs.readJSON` and `vfs.write(path, data, contentType?)` / `vfs.writeBytes` / `vfs.writeJSON`, plus `vfs.list()`, `vfs.exists(path)`, `vfs.remove(path)`. Files you write are saved back as sources. Browser-native APIs (WebCodecs, OffscreenCanvas, crypto.subtle, WebAssembly) and the bundled `mediabunny` global are available. Use top-level `await` directly; `return` a value or `console.log(...)` for output.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "JavaScript to execute. Use the `vfs` helper to read and write sources.",
          },
        },
        required: ["code"],
        additionalProperties: false,
      },
      function: async (args: Record<string, unknown>) => {
        const code = typeof args.code === "string" ? args.code : "";
        if (!code.trim()) {
          return [{ type: "text" as const, text: "Error: `code` is required." }];
        }

        // Same locking rationale as the python tool — the sandbox runtimes are
        // shared singletons and must not interleave on the source snapshot.
        return withSandboxLock(async () => {
          const before = sourcesToFileMap(getSources());

          try {
            const result = await executeJavaScript({ code, files: before });

            if (!result.success) {
              return [{ type: "text" as const, text: `Error executing code: ${result.error || "Unknown error"}` }];
            }

            const after = normalizeMapKeys(result.files ?? {});
            const written = await persistWrites(before, after);

            const parts: string[] = [result.output || "(no output)"];
            if (written.length > 0) {
              parts.push(`\nSaved sources: ${written.join(", ")}`);
            }
            return [{ type: "text" as const, text: parts.join("") }];
          } catch (err) {
            return [
              {
                type: "text" as const,
                text: `JavaScript execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
              },
            ];
          }
        });
      },
    },
    {
      name: "execute_bash_code",
      description:
        "Execute bash commands in a sandboxed shell. All notebook sources are preloaded under `/home/user/`, and files created or modified there are saved back as notebook sources. Supports pipes, redirections, loops, jq, yq, grep, sed, awk, and sqlite3.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command or script to execute. Full shell syntax supported.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
      function: async (args: Record<string, unknown>) => {
        const command = typeof args.command === "string" ? args.command : "";
        if (!command.trim()) {
          return [{ type: "text" as const, text: "Error: `command` is required." }];
        }

        // Same locking rationale as the python tool above — the bash
        // runtime is additionally a singleton working tree.
        return withSandboxLock(async () => {
          const before = sourcesToFileMap(getSources());
          const { memFs } = getSingleton();

          try {
            const inputFiles = Object.entries(before).map(([path, rec]) => ({
              path,
              content: rec.content,
              contentType: rec.contentType,
            }));
            await loadArtifactsIntoFs(memFs, inputFiles);

            const result = await executeBash({ command });

            const after = normalizeMapKeys(await readFilesFromFs(memFs));
            const written = await persistWrites(before, after);

            const parts: string[] = [];
            if (result.stdout) parts.push(result.stdout);
            if (result.stderr) parts.push(`stderr: ${result.stderr}`);
            if (result.exitCode !== 0) parts.push(`exit code: ${result.exitCode}`);
            if (written.length > 0) parts.push(`Saved sources: ${written.join(", ")}`);

            const output = parts.join("\n") || "Command executed successfully (no output)";
            if (!result.success) {
              return [{ type: "text" as const, text: `Error: ${output}` }];
            }
            return [{ type: "text" as const, text: output }];
          } catch (err) {
            return [
              {
                type: "text" as const,
                text: `Bash execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
              },
            ];
          }
        });
      },
    },
  ];
}
