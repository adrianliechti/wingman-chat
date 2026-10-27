import { FileText, FolderOpen, Loader2, Save, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useChatActions, useChatList } from "@/features/chat/hooks/useChat";
import { useChatNavigate } from "@/features/chat/hooks/useChatNavigate";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { confirm } from "@/shared/lib/confirm";
import { flushPersistence } from "@/shared/lib/persistence";
import { formatBytes } from "@/shared/lib/utils";
import { cn } from "@/shared/lib/cn";
import { useProjects } from "../context/ProjectsContext";
import { readProjectFile } from "../lib/projectStorage";

const inputClass =
  "w-full rounded-xl border border-neutral-200 bg-white/60 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50 dark:border-neutral-700 dark:bg-neutral-900/60 dark:focus:border-neutral-500 dark:focus:ring-neutral-700/50";
const buttonClass = "rounded-lg px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50";

export function ProjectSettings({ projectId }: { projectId: string }) {
  const { projects, createProject, updateProject, deleteProject, addFile, removeFile, editProject, selectProject } =
    useProjects();
  const [savedId, setSavedId] = useState(projectId === "new" ? null : projectId);
  const project = projects.find((p) => p.id === savedId);
  const { chats } = useChatList();
  const { updateChat, ensureChat } = useChatActions();
  const { openChat, newChat } = useChatNavigate();
  const { openFile, setShowArtifactsDrawer, isAvailable } = useArtifacts();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [instructions, setInstructions] = useState(project?.instructions ?? "");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => editProject(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const upload = (files: File[]) => {
    if (busy || !files.length) return;
    if (!savedId) {
      setPendingFiles((pending) => [...pending, ...files]);
      return;
    }
    void run(async () => {
      for (const file of files) await addFile(savedId, file);
    });
  };
  const save = () =>
    run(async () => {
      const id = savedId ?? (await createProject(name)).id;
      setSavedId(id);
      await updateProject(id, { name: name.trim(), description, instructions });
      for (const file of pendingFiles) {
        await addFile(id, file);
        setPendingFiles((pending) => pending.filter((f) => f !== file));
      }
      if (projectId === "new") {
        selectProject(id);
        newChat();
        editProject(id);
      } else close();
    });
  const remove = () =>
    run(async () => {
      if (
        !project ||
        !(await confirm({
          title: `Delete ${project.name}?`,
          message:
            "The project's instructions and shared files will be removed. Its conversations and their files will be kept in All chats.",
          confirmLabel: "Delete project",
          danger: true,
        }))
      )
        return;
      chats
        .filter((c) => c.projectId === project.id)
        .forEach((chat) => updateChat(chat.id, () => ({ projectId: undefined }), { preserveDates: true }));
      await flushPersistence();
      await deleteProject(project.id);
      newChat();
    });
  const files = project?.files ?? [];
  return (
    <section
      aria-label={projectId === "new" ? "New project" : "Project settings"}
      className="h-full w-full overflow-y-auto bg-white pt-14 text-neutral-900 md:pt-[3.6875rem] dark:bg-neutral-950 dark:text-neutral-100"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-6 md:px-10 md:py-10"
      >
        <header className="mb-8 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
              {projectId === "new" ? "New project" : "Project settings"}
            </h1>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Shared context for every conversation in this project.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {project && (
              <button
                type="button"
                aria-label="Delete project"
                title="Delete project"
                disabled={busy}
                onClick={() => void remove()}
                className="rounded-lg p-2 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30 dark:hover:text-red-400"
              >
                <Trash2 size={17} />
              </button>
            )}
            <button
              type="submit"
              aria-label={projectId === "new" ? "Create project" : "Save"}
              title={projectId === "new" ? "Create project" : "Save changes"}
              disabled={busy || !name.trim()}
              className={cn(
                buttonClass,
                "shrink-0 font-medium text-neutral-600 dark:text-neutral-300",
                projectId !== "new" && "p-2",
              )}
            >
              {busy ? (
                <Loader2 size={18} className="animate-spin" />
              ) : projectId === "new" ? (
                "Create project"
              ) : (
                <Save size={18} />
              )}
            </button>
            <button
              type="button"
              aria-label="Close project"
              title="Close project"
              disabled={busy}
              onClick={close}
              className={`${buttonClass} shrink-0 p-2`}
            >
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="grid flex-1 content-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-12">
          <div className="space-y-6">
            <label className="block space-y-2 text-sm font-medium">
              <span>Name</span>
              <input
                autoFocus
                required
                maxLength={120}
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Give your project a name"
              />
            </label>
            <label className="block space-y-2 text-sm font-medium">
              <span>Description</span>
              <input
                className={inputClass}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What are you working on?"
              />
            </label>
            <label className="block space-y-2 text-sm font-medium">
              <span>Instructions</span>
              <textarea
                rows={10}
                className={`${inputClass} min-h-48 resize-y leading-relaxed font-normal`}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Add context, preferences, and goals for every chat in this project…"
              />
            </label>
          </div>
          <section aria-label="Shared files" className="min-w-0">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">Shared files</h2>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
              Add documents, images, and data your chats can use. Open a copy to work on a file in a conversation.
            </p>
            <input
              ref={inputRef}
              aria-label="Add project files"
              type="file"
              multiple
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                upload(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy}
              aria-label="Upload project files"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!busy) setDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragging(false);
                upload(Array.from(e.dataTransfer.files));
              }}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 transition-colors disabled:opacity-50",
                dragging
                  ? "border-neutral-500 bg-neutral-100 dark:border-neutral-400 dark:bg-neutral-800"
                  : "border-neutral-200 bg-neutral-50/70 hover:border-neutral-400 hover:bg-neutral-100/60 dark:border-neutral-700 dark:bg-neutral-900/40 dark:hover:border-neutral-500 dark:hover:bg-neutral-800/50",
              )}
            >
              <span className="rounded-xl bg-white p-3 text-neutral-500 shadow-sm ring-1 ring-black/5 dark:bg-neutral-800 dark:text-neutral-400 dark:ring-white/5">
                {busy ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
              </span>
              <span className="text-center">
                <span className="block text-sm font-medium">
                  {dragging ? "Drop files to add" : "Drop files here or click to browse"}
                </span>
                <span className="mt-1 block text-xs text-neutral-400">Documents, images, spreadsheets, and more</span>
              </span>
            </button>
            <div className="mt-4 space-y-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="group flex items-center gap-3 rounded-xl border border-neutral-200/80 p-3 dark:border-neutral-800"
                >
                  <FileText size={18} className="shrink-0 text-neutral-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={file.name}>
                      {file.name}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-400">{formatBytes(file.size ?? 0)}</p>
                  </div>
                  {isAvailable && (
                    <button
                      type="button"
                      disabled={busy}
                      title="Open a copy in this chat"
                      aria-label={`Open copy of ${file.name}`}
                      className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      onClick={() =>
                        void run(async () => {
                          if (!project) return;
                          const source = await readProjectFile(project, file.path);
                          if (!source) throw new Error("File not found");
                          const { chat, fs } = await ensureChat();
                          const copied = await fs.ingestFiles(
                            [{ ...source, contentType: source.contentType ?? "application/octet-stream" }],
                            { origin: { actor: "user", reason: "upload" } },
                          );
                          openChat(chat.id);
                          openFile(copied.pathMap[source.path] ?? source.path);
                          setShowArtifactsDrawer(true);
                        })
                      }
                    >
                      <FolderOpen size={17} />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => void run(() => removeFile(project!.id, file.id))}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              {pendingFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 rounded-xl border border-neutral-200/80 p-3 dark:border-neutral-800"
                >
                  <FileText size={18} className="shrink-0 text-neutral-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="mt-0.5 text-xs text-neutral-400">{formatBytes(file.size)} · Ready to upload</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="p-2 text-neutral-400 hover:text-red-600"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setPendingFiles((pending) => pending.filter((_, i) => i !== index))}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
        {error && (
          <p role="alert" className="mt-6 text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
