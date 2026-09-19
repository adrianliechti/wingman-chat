import { BrainCircuit } from "lucide-react";
import type { ToolDisplay, ToolDisplayState } from "@/shared/types/chat";
import { isMemoryPath, memoryPath } from "./memoryDocument";

export function memoryOperationPaths(operation: string, args: Record<string, unknown>): unknown[] {
  if (operation === "edit") return Array.isArray(args.edits) ? args.edits.map((edit) => edit?.file_path) : [];
  if (operation === "move") return [args.from, args.to];
  return [operation === "glob" || operation === "grep" ? (args.path ?? "/") : args.file_path];
}

const labels: Record<string, [string, string, string]> = {
  read: ["Reading memory…", "Read memory", "Memory read failed"],
  create: ["Remembering…", "Remembered", "Could not remember"],
  edit: ["Updating memory…", "Updated memory", "Memory update failed"],
  delete: ["Forgetting…", "Forgot memory", "Could not forget"],
  move: ["Organizing memory…", "Organized memory", "Memory move failed"],
  glob: ["Searching memory…", "Searched memory", "Memory search failed"],
  grep: ["Searching memory…", "Searched memory", "Memory search failed"],
};

/** Derived from persisted arguments, so old calls still render with memory off. */
export function memoryFileHeader(
  name: string,
  args: Record<string, unknown> | null,
  state: ToolDisplayState,
): ReturnType<NonNullable<ToolDisplay["header"]>> | undefined {
  if (!args || !name.startsWith("artifacts_")) return;
  const operation = name.slice("artifacts_".length);
  const label = labels[operation];
  if (!label) return;
  const paths = [...new Set(memoryOperationPaths(operation, args).filter(isMemoryPath))] as string[];
  if (!paths.length) return;
  const note = (path: string) => {
    try {
      const relative = memoryPath(path);
      return !relative ? "All notes" : relative === "index.md" ? "Memory index" : relative.replace(/\.md$/, "");
    } catch {
      return "Memory note";
    }
  };
  const preview =
    operation === "move" && paths.length === 2
      ? `${note(paths[0])} → ${note(paths[1])}`
      : paths.length === 1
        ? note(paths[0])
        : `${paths.length} notes`;
  return { icon: BrainCircuit, label: label[state.error ? 2 : state.running ? 0 : 1], preview };
}
