import { FolderPlus } from "lucide-react";
import { useState } from "react";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { contentToBlob } from "@/shared/lib/fileContent";
import { artifactRevision } from "@/shared/types/artifact";
import { notify } from "@/shared/lib/notify";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import { useProjects } from "../context/ProjectsContext";

export function SaveToProject({ fs, path, disabled }: { fs: FileSystemManager; path: string; disabled?: boolean }) {
  const { projects, addFile } = useProjects();
  const [busy, setBusy] = useState(false);
  if (!projects.length) return null;
  const save = async (id: string) => {
    setBusy(true);
    try {
      const file = await fs.getFile(path);
      if (!file) throw new Error("File no longer exists");
      await addFile(
        id,
        new File([contentToBlob(file.content, file.contentType)], path.split("/").at(-1)!, { type: file.contentType }),
        { chatId: fs.chatId, path, revision: await artifactRevision(file.content, file.contentType) },
      );
      notify.success("Saved to project", "A copy is available in all of this project's chats.");
    } catch (error) {
      notify.error("Couldn't save to project", error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu
      trigger={
        <MenuButton
          disabled={busy || disabled}
          title={disabled ? "Save your edits first" : "Save to project"}
          aria-label="Save to project"
          className="rounded p-2 md:p-1.5 text-neutral-600 hover:bg-black/5 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-white/5"
        >
          <FolderPlus size={14} />
        </MenuButton>
      }
    >
      {projects.map((p) => (
        <DropdownMenuItem key={p.id} onClick={() => void save(p.id)}>
          {p.name}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}
