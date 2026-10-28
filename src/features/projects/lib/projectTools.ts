import { z } from "zod";
import { createReadonlyFileTools } from "@/shared/lib/file-tools";
import { FileSystemManager } from "@/features/artifacts/lib/fs";
import type { Tool } from "@/shared/types/chat";
import type { Project } from "./projects";
import { readProjectFile } from "./projectStorage";
import { projectToolHeader } from "./projectToolDisplay";

export function projectInstructions(project: Project): string {
  return [
    `Current project: ${JSON.stringify(project.name)}.`,
    project.description,
    project.instructions,
    project.files.length
      ? `Shared project files (read-only originals):\n${project.files.map((f) => JSON.stringify(f.path)).join("\n")}\nUse project_read/grep/glob to inspect text. Use project_copy to bring a file into this conversation before using code, vision, or editing it. Copies do not change the shared original.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Closures retain the project's file manifest for the requesting run. */
export function createProjectTools(project: Project): Tool[] {
  const readTools = createReadonlyFileTools(
    {
      list: async () => project.files,
      read: (path) => readProjectFile(project, path),
    },
    { namespace: "project", spaceName: "current project" },
  ).map(
    (tool) =>
      ({
        ...tool,
        display: { ...tool.display, header: (args, state) => projectToolHeader(tool.name, args, state)! },
      }) satisfies Tool,
  );
  return [
    ...readTools,
    {
      name: "project_copy",
      title: "Copy project file",
      display: {
        header: (args, state) => projectToolHeader("project_copy", args, state)!,
      },
      description:
        "Copy a shared project file into the current conversation workspace for code execution, document extraction, vision, or editing. The shared original stays unchanged. Returns the copy's actual path; existing conversation files are never overwritten.",
      inputSchema: z.strictObject({ path: z.string().describe("Absolute path from the current project's file list.") }),
      execute: async (args, execution) => {
        const context = execution?.context;
        if (!context?.chatId) throw new Error("A conversation is required");
        context.signal?.throwIfAborted();
        const file = await readProjectFile(project, String(args.path));
        if (!file) throw new Error("File not found in this project");
        context.signal?.throwIfAborted();
        const fs = new FileSystemManager(context.chatId);
        const result = await fs.ingestFiles(
          [{ ...file, contentType: file.contentType ?? "application/octet-stream" }],
          { origin: { actor: "user", reason: "upload" } },
        );
        return [{ type: "text", content: JSON.stringify({ path: result.pathMap[file.path] ?? file.path }) }];
      },
    },
  ];
}
