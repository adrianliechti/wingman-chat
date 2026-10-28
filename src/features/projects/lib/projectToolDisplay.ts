import { FolderOpen } from "lucide-react";
import type { ToolDisplay, ToolDisplayState } from "@/shared/types/chat";
import { toolPreviewPath, toolPreviewText } from "@/shared/lib/toolPreview";

const labels: Record<string, [string, string, string]> = {
  project_read: ["Reading project file…", "Read project file", "Project read failed"],
  project_grep: ["Searching project files…", "Searched project files", "Project search failed"],
  project_glob: ["Finding project files…", "Found project files", "Project lookup failed"],
  project_copy: ["Copying project file…", "Copied project file", "Project copy failed"],
};

/** Also identifies saved tool calls after their project is moved or deleted. */
export function projectToolHeader(
  name: string,
  args: Record<string, unknown> | undefined | null,
  state: ToolDisplayState,
): ReturnType<NonNullable<ToolDisplay["header"]>> | undefined {
  const label = labels[name];
  if (!label) return undefined;
  return {
    icon: FolderOpen,
    label: label[state.error ? 2 : state.running ? 0 : 1],
    preview:
      name === "project_read" || name === "project_copy" ? toolPreviewPath(args?.path) : toolPreviewText(args?.pattern),
  };
}
