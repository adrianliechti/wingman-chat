/**
 * Execution tools (Python + Bash) for notebooks.
 *
 * Mirrors the artifact chat's execute_python_code / execute_bash_code tools,
 * but with notebook sources as the filesystem root.
 *
 * Symmetric mapping:
 *   notebook source path `data.csv` ↔ sandbox path `/home/user/data.csv`
 *
 * Before each run: all sources are loaded into the Pyodide VFS and the
 * bash InMemoryFs at `/home/user/`.
 * After each run: files present at `/home/user/` are diffed against the
 * pre-run sources; additions and modifications are saved back as sources
 * via `onWrite`. Deletions are NOT propagated — sources are treated as
 * append-only from code execution (the model should use `source_create`
 * to explicitly replace, and users remove sources through the UI).
 */

import { executeBash, getSingleton, loadArtifactsIntoFs, readFilesFromFs } from "@/features/tools/lib/bash";
import { executeCode } from "@/features/tools/lib/interpreter";
import type { Tool } from "@/shared/types/chat";
import type { File } from "@/shared/types/file";

interface FileRecord {
  content: string;
  contentType?: string;
}

type FileMap = Record<string, FileRecord>;

/** Convert the sources array to the Record<path, {content, contentType}> shape. */
function sourcesToFileMap(sources: readonly File[]): FileMap {
  const map: FileMap = {};
  for (const s of sources) {
    map[s.path] = { content: s.content, contentType: s.contentType };
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
 * Create execution tools (python + bash) that expose notebook sources as
 * the working filesystem. Sources are mounted at `/home/user/` before
 * execution and changes are persisted back via `onWrite`.
 */
export function createSourceExecTools(
  getSources: () => readonly File[],
  options: SourceExecToolsOptions,
): Tool[] {
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
        "Execute Python code in a sandboxed Pyodide environment. All notebook sources are available under `/home/user/`, and files created or modified there are saved back as notebook sources. Packages numpy, pandas, matplotlib, plotly, pillow, openpyxl, pypdf, python-docx, beautifulsoup4 are preloaded.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Python code to execute. Use standard I/O under `/home/user/` to read and write files.",
          },
          packages: {
            type: "array",
            items: { type: "string" },
            description: "Optional extra Python packages to load (e.g., ['scikit-learn']).",
          },
        },
        required: ["code"],
      },
      function: async (args: Record<string, unknown>) => {
        const code = (args.code as string) ?? "";
        const packages = args.packages as string[] | undefined;
        if (!code.trim()) {
          return [{ type: "text" as const, text: "Error: `code` is required." }];
        }

        const before = sourcesToFileMap(getSources());

        try {
          const result = await executeCode({ code, packages, files: before });

          if (!result.success) {
            return [{ type: "text" as const, text: `Error executing code: ${result.error || "Unknown error"}` }];
          }

          const after = result.files ?? {};
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
      },
    },
    {
      name: "execute_bash_code",
      description:
        "Execute bash commands in a sandboxed shell. All notebook sources are preloaded under `/home/user/`, and files created or modified there are saved back as notebook sources. Supports pipes, redirections, loops, jq, yq, grep, sed, awk, and sqlite3.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command or script to execute. Full shell syntax supported.",
          },
        },
        required: ["command"],
      },
      function: async (args: Record<string, unknown>) => {
        const command = (args.command as string) ?? "";
        if (!command.trim()) {
          return [{ type: "text" as const, text: "Error: `command` is required." }];
        }

        const before = sourcesToFileMap(getSources());
        const { memFs } = getSingleton();

        try {
          // Mount all sources into /home/user/...
          const inputFiles = Object.entries(before).map(([path, rec]) => ({
            path,
            content: rec.content,
            contentType: rec.contentType,
          }));
          await loadArtifactsIntoFs(memFs, inputFiles);

          const result = await executeBash({ command });

          const after = await readFilesFromFs(memFs);
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
      },
    },
  ];
}
