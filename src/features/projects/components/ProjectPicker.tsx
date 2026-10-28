import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { ChevronDown, FolderPlus, Settings2 } from "lucide-react";
import { useState } from "react";
import { useChatActions, useChatList } from "@/features/chat/hooks/useChat";
import { useChatNavigate } from "@/features/chat/hooks/useChatNavigate";
import { DropdownMenu, DropdownMenuDivider, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { notify } from "@/shared/lib/notify";
import { useSidebar } from "@/shell/hooks/useSidebar";
import { useProjects } from "../context/ProjectsContext";

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700";
export function ProjectPicker() {
  const { projects, selectedProjectId, selectProject, editProject } = useProjects();
  const { newChat } = useChatNavigate();
  const { setShowSidebar } = useSidebar();
  const selected = projects.find((p) => p.id === selectedProjectId);
  const choose = (id: string | null) => {
    selectProject(id);
    newChat();
  };
  const edit = (id: string) => {
    editProject(id);
    if (window.innerWidth < 768) setShowSidebar(false);
  };
  return (
    <div className="min-w-0 flex-1 pl-2">
      <DropdownMenu
        panelClassName="min-w-52 max-w-80"
        trigger={
          <MenuButton
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-neutral-800 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/5"
            aria-label="Choose project"
            title={selected?.name ?? "All chats"}
          >
            <span className="truncate">{selected?.name ?? "All chats"}</span>
            <ChevronDown size={13} className="shrink-0 opacity-60" />
          </MenuButton>
        }
      >
        <DropdownMenuItem selected={!selected} onClick={() => choose(null)}>
          All chats
        </DropdownMenuItem>
        <div className="max-h-72 overflow-y-auto">
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} selected={p.id === selected?.id} onClick={() => choose(p.id)}>
              <span className="block truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuDivider />
        <DropdownMenuItem icon={<FolderPlus size={15} />} onClick={() => edit("new")}>
          New project
        </DropdownMenuItem>
        {selected && (
          <DropdownMenuItem icon={<Settings2 size={15} />} onClick={() => edit(selected.id)}>
            Project settings
          </DropdownMenuItem>
        )}
      </DropdownMenu>
    </div>
  );
}

export function MoveChatDialog({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const { projects, selectProject } = useProjects();
  const { chats, chatId: activeId } = useChatList();
  const { updateChat } = useChatActions();
  const [target, setTarget] = useState(chats.find((c) => c.id === chatId)?.projectId ?? "");
  return (
    <Dialog open onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" />
      <div className="fixed inset-0 grid place-items-center p-4">
        <DialogPanel className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 dark:bg-neutral-950">
          <DialogTitle className="font-medium">Move chat to project</DialogTitle>
          <select
            aria-label="Destination project"
            className={inputClass}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800/60"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 dark:bg-neutral-200 dark:text-neutral-900"
              onClick={() => {
                updateChat(chatId, () => ({ projectId: target || undefined }), { preserveDates: true });
                if (activeId === chatId) selectProject(target || null);
                onClose();
                notify.success("Chat moved");
              }}
            >
              Move
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
