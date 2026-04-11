import { useCallback, useMemo } from "react";
import { Paperclip } from "lucide-react";
import { useArtifacts } from "./useArtifacts";
import type { Tool, ToolProvider } from "@/shared/types/chat";
import artifactsInstructionsText from "@/features/artifacts/prompts/artifacts.txt?raw";
import interpreterInstructionsText from "@/features/artifacts/prompts/interpreter.txt?raw";
import { executeCode } from "@/features/tools/lib/interpreter";
import { executeBash, getSingleton, loadArtifactsIntoFs, readFilesFromFs } from "@/features/tools/lib/bash";
import { normalizeArtifactPath } from "@/shared/lib/artifactFiles";

export function useArtifactsProvider(): ToolProvider | null {
  const { fs, activeFile, isAvailable } = useArtifacts();

  const artifactsTools = useCallback((): Tool[] => {
    return [
      {
        name: "create_file",
        description:
          "Create a new file or update an existing file in the virtual filesystem with the specified path and content.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "The file path (e.g., /projects/test.go, /src/index.js). Should start with / and include the full directory structure.",
            },
            content: {
              type: "string",
              description: "The content of the file to create.",
            },
          },
          required: ["path", "content"],
        },
        function: async (args: Record<string, unknown>) => {
          const path = normalizeArtifactPath(args.path as string);
          const content = args.content as string;

          if (!path || !content) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Path and content are required" }) }];
          }

          try {
            if (!fs) {
              return [{ type: "text" as const, text: JSON.stringify({ error: "File system not available" }) }];
            }
            await fs.createFile(path, content);
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  message: `File created: ${path}`,
                  path,
                }),
              },
            ];
          } catch {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Failed to create file" }) }];
          }
        },
      },
      {
        name: "list_files",
        description: "List all files in the virtual filesystem, optionally filtered by directory path.",
        parameters: {
          type: "object",
          properties: {
            directory: {
              type: "string",
              description:
                "Optional directory path to filter files (e.g., /src, /components). If not provided, lists all files.",
            },
          },
          required: [],
        },
        function: async (args: Record<string, unknown>) => {
          const path = normalizeArtifactPath((args.directory as string) ?? "/");

          if (!fs) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "File system not available" }) }];
          }

          try {
            const allFiles = await fs.listEntries();
            const filteredFiles =
              !path || path === "/" ? allFiles : allFiles.filter((file) => file.path.startsWith(path));

            const fileList = filteredFiles.map((file) => ({
              path: file.path,
              size: file.size,
              contentType: file.contentType,
            }));

            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  files: fileList,
                  count: fileList.length,
                }),
              },
            ];
          } catch {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Failed to list files" }) }];
          }
        },
      },
      {
        name: "delete_file",
        description:
          "Delete a file or folder from the virtual filesystem. When deleting a folder, all files within it will be deleted.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file or folder path to delete (e.g., /src/index.js or /src/components)",
            },
          },
          required: ["path"],
        },
        function: async (args: Record<string, unknown>) => {
          const path = normalizeArtifactPath(args.path as string);

          if (!path) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Path is required" }) }];
          }

          if (!fs) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "File system not available" }) }];
          }

          const file = await fs.getFile(path);
          const allFiles = await fs.listEntries();
          const isFolder = allFiles.some((f) => f.path.startsWith(`${path}/`));

          if (!file && !isFolder) {
            return [{ type: "text" as const, text: JSON.stringify({ error: `File or folder not found: ${path}` }) }];
          }

          try {
            const success = await fs.deleteFile(path);
            if (success) {
              const itemType = file ? "file" : "folder";
              return [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    message: `${itemType} deleted: ${path}`,
                    path,
                  }),
                },
              ];
            } else {
              return [{ type: "text" as const, text: JSON.stringify({ error: `Failed to delete: ${path}` }) }];
            }
          } catch {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Failed to delete item" }) }];
          }
        },
      },
      {
        name: "move_file",
        description: "Move or rename a file in the virtual filesystem from one path to another.",
        parameters: {
          type: "object",
          properties: {
            from: {
              type: "string",
              description: "The source file path (e.g., /src/old-name.js)",
            },
            to: {
              type: "string",
              description: "The destination file path (e.g., /src/new-name.js)",
            },
          },
          required: ["from", "to"],
        },
        function: async (args: Record<string, unknown>) => {
          const fromPath = normalizeArtifactPath(args.from as string);
          const toPath = normalizeArtifactPath(args.to as string);

          if (!fromPath || !toPath) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Both from and to path are required" }) }];
          }

          if (!fs) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "File system not available" }) }];
          }

          const sourceFile = await fs.getFile(fromPath);
          if (!sourceFile) {
            return [{ type: "text" as const, text: JSON.stringify({ error: `Source file not found: ${fromPath}` }) }];
          }

          const destFile = await fs.getFile(toPath);
          if (destFile) {
            return [
              { type: "text" as const, text: JSON.stringify({ error: `Destination file already exists: ${toPath}` }) },
            ];
          }

          try {
            const success = await fs.renameFile(fromPath, toPath);

            if (!success) {
              return [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: `Failed to move file from ${fromPath} to ${toPath}. Source may not exist or destination already exists.`,
                  }),
                },
              ];
            }

            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  message: `File moved from ${fromPath} to ${toPath}`,
                  fromPath,
                  toPath,
                }),
              },
            ];
          } catch {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Failed to move file" }) }];
          }
        },
      },
      {
        name: "read_file",
        description: "Read the content of a specific file from the virtual filesystem.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path to read (e.g., /src/index.js)",
            },
          },
          required: ["path"],
        },
        function: async (args: Record<string, unknown>) => {
          const path = normalizeArtifactPath(args.path as string);

          if (!path) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Path is required" }) }];
          }

          if (!fs) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "File system not available" }) }];
          }

          const file = await fs.getFile(path);

          if (!file) {
            return [{ type: "text" as const, text: JSON.stringify({ error: `File not found: ${path}` }) }];
          }

          try {
            const fileInfo = {
              path,
              size: file.content.length,
              content: file.content,
              contentType: file.contentType,
            };

            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  file: fileInfo,
                }),
              },
            ];
          } catch {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Failed to read file content" }) }];
          }
        },
      },
      {
        name: "current_path",
        description: "Get the file path of the currently opened file in the artifacts editor.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
        function: async () => {
          if (!fs) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "File system not available" }) }];
          }

          try {
            if (!activeFile) {
              return [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    message: "No file is currently active",
                    currentPath: null,
                  }),
                },
              ];
            }

            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  currentPath: activeFile,
                }),
              },
            ];
          } catch {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Failed to get current path" }) }];
          }
        },
      },
      {
        name: "current_file",
        description: "Get the file path and content of the currently opened file in the artifacts editor.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
        function: async () => {
          if (!fs) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "File system not available" }) }];
          }

          try {
            if (!activeFile) {
              return [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    message: "No file is currently active",
                    currentFile: null,
                  }),
                },
              ];
            }
            const file = await fs.getFile(activeFile);

            if (!file) {
              return [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: `Active file not found: ${activeFile}`,
                  }),
                },
              ];
            }

            const fileInfo = {
              path: file.path,
              size: file.content.length,
              content: file.content,
              contentType: file.contentType,
            };

            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  currentFile: fileInfo,
                }),
              },
            ];
          } catch {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Failed to get current file info" }) }];
          }
        },
      },
      // --- Code Execution Tools ---
      {
        name: "execute_python_code",
        description:
          "Execute Python code or an existing Python artifact file with optional package dependencies. Provide exactly one of `code` or `path`. All artifact files are available under /home/user/, and files written there are synced back.",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description:
                "Inline Python code to execute. Prefer this for short snippets; use `path` for existing scripts in artifacts.",
            },
            path: {
              type: "string",
              description:
                "Path to a Python script in the artifacts filesystem to execute, such as `/analysis.py`. Prefer this for existing or longer scripts.",
            },
            packages: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional list of Python packages required (e.g., ['numpy', 'pandas']). These will be available for import.",
            },
          },
          required: [],
        },
        function: async (args: Record<string, unknown>) => {
          const { code, packages } = args;
          const path = normalizeArtifactPath(args.path as string | undefined);

          try {
            // Load artifact files into Pyodide's VFS
            const artifactFiles: Record<string, { content: string; contentType?: string }> = {};
            if (fs?.isReady) {
              const snapshot = await fs.getOverlaySnapshot();
              for (const [path, file] of Object.entries(snapshot)) {
                artifactFiles[path] = { content: file.content, contentType: file.contentType };
              }
            }

            const hasCode = typeof code === "string" && code.trim().length > 0;
            const hasPath = typeof path === "string" && path.length > 0;

            if (hasCode === hasPath) {
              return [
                {
                  type: "text" as const,
                  text: "Error executing code: provide exactly one of `code` or `path`.",
                },
              ];
            }

            let script = code as string;

            if (hasPath) {
              if (!fs) {
                return [{ type: "text" as const, text: "Error executing code: file system not available." }];
              }

              const file = await fs.getFile(path);
              if (!file) {
                return [{ type: "text" as const, text: `Error executing code: file not found: ${path}` }];
              }

              script = file.content;
            }

            const result = await executeCode({
              code: script,
              packages: packages as string[] | undefined,
              files: artifactFiles,
            });

            if (!result.success) {
              return [{ type: "text" as const, text: `Error executing code: ${result.error || "Unknown error"}` }];
            }

            // Sync changed files back to artifacts
            if (fs?.isReady && result.files) {
              await fs.applyOverlaySnapshot(result.files, { deleteMissing: false });
            }

            return [{ type: "text" as const, text: result.output }];
          } catch (error) {
            return [
              {
                type: "text" as const,
                text: `Code execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ];
          }
        },
      },
      {
        name: "execute_bash_code",
        description:
          "Execute bash commands or scripts in a sandboxed shell. All artifact files are preloaded and any files created or modified are synced back. Prefer explicit paths rather than relying on prior shell state. Supports pipes, redirections, loops, variables, jq, yq, xan, sqlite3, grep, sed, awk, and more.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                "The bash command or script to execute. Supports full shell syntax: pipes (|), redirections (>, >>), chaining (&&, ||, ;), variables, loops, functions, and glob patterns.",
            },
          },
          required: ["command"],
        },
        function: async (args: Record<string, unknown>) => {
          const { command } = args;

          try {
            // Load artifact files into bash's InMemoryFs before execution
            if (fs?.isReady) {
              const { memFs } = getSingleton();
              const snapshot = await fs.getOverlaySnapshot();
              const artifactFiles = Object.entries(snapshot).map(([path, file]) => ({
                path,
                content: file.content,
                contentType: file.contentType,
              }));
              await loadArtifactsIntoFs(memFs, artifactFiles);
            }

            const result = await executeBash({
              command: command as string,
            });

            // Save changed files back to artifacts after execution
            if (fs?.isReady) {
              const { memFs } = getSingleton();
              const currentFiles = await readFilesFromFs(memFs);

              await fs.applyOverlaySnapshot(currentFiles, { deleteMissing: false });
            }

            const parts: string[] = [];
            if (result.stdout) parts.push(result.stdout);
            if (result.stderr) parts.push(`stderr: ${result.stderr}`);
            if (result.exitCode !== 0) parts.push(`exit code: ${result.exitCode}`);

            const output = parts.join("\n") || "Command executed successfully (no output)";

            if (!result.success) {
              return [{ type: "text" as const, text: `Error: ${output}` }];
            }

            return [{ type: "text" as const, text: output }];
          } catch (error) {
            return [
              {
                type: "text" as const,
                text: `Bash execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ];
          }
        },
      },
    ];
  }, [fs, activeFile]);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: "artifacts",
      name: "File System",
      description: "Create and edit files, run Python and Bash code",
      icon: Paperclip,
      instructions: `${artifactsInstructionsText}\n\n${interpreterInstructionsText}`,
      tools: artifactsTools(),
    };
  }, [isAvailable, artifactsTools]);

  return provider;
}
