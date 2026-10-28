import { FolderOpen, Loader2, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useChatActions, useChatList } from "@/features/chat/hooks/useChat";
import { useChatNavigate } from "@/features/chat/hooks/useChatNavigate";
import { useComposerDraftStore } from "@/features/chat/context/ComposerDraftProvider";
import { composerDraftKey } from "@/features/chat/lib/composerDrafts";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { confirm } from "@/shared/lib/confirm";
import { flushPersistence } from "@/shared/lib/persistence";
import { formatBytes } from "@/shared/lib/utils";
import { cn } from "@/shared/lib/cn";
import { FileIcon } from "@/shared/ui/FileIcon";
import { useProjects } from "../context/ProjectsContext";
import { readProjectFile } from "../lib/projectStorage";

const inputClass =
  "w-full rounded-xl border border-neutral-200 bg-white/60 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50 dark:border-neutral-700 dark:bg-neutral-900/60 dark:focus:border-neutral-500 dark:focus:ring-neutral-700/50";
// Long file lists get a filter so a single file stays easy to find.
const FILTER_THRESHOLD = 8;

export function ProjectSettings({ projectId }: { projectId: string }) {
  const { projects, createProject, updateProject, deleteProject, addFile, removeFile, editProject, selectProject } =
    useProjects();
  const [savedId, setSavedId] = useState(projectId === "new" ? null : projectId);
  const project = projects.find((p) => p.id === savedId);
  const { chats } = useChatList();
  const { updateChat, ensureChat } = useChatActions();
  const { openChat, newChat } = useChatNavigate();
  const drafts = useComposerDraftStore();
  const { openFile, setShowArtifactsDrawer, isAvailable } = useArtifacts();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [instructions, setInstructions] = useState(project?.instructions ?? "");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [removedFileIds, setRemovedFileIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const hasUnsavedChanges =
    name !== (project?.name ?? "") ||
    description !== (project?.description ?? "") ||
    instructions !== (project?.instructions ?? "") ||
    pendingFiles.length > 0 ||
    removedFileIds.length > 0;
  const confirmDiscard = async () =>
    !hasUnsavedChanges ||
    (await confirm({
      title: "Discard changes?",
      message: "Your unsaved edits to this project will be lost.",
      confirmLabel: "Discard changes",
      danger: true,
    }));
  const close = async () => {
    if (!busyRef.current && (await confirmDiscard())) editProject(null);
  };
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const upload = (files: File[]) => {
    if (busyRef.current || !files.length) return;
    setPendingFiles((pending) => [...pending, ...files]);
  };
  const save = () =>
    run(async () => {
      const id = savedId ?? (await createProject(name)).id;
      setSavedId(id);
      await updateProject(id, { name: name.trim(), description, instructions });
      for (const fileId of removedFileIds) {
        await removeFile(id, fileId);
        setRemovedFileIds((removed) => removed.filter((entry) => entry !== fileId));
      }
      for (const file of pendingFiles) {
        await addFile(id, file);
        setPendingFiles((pending) => pending.filter((f) => f !== file));
      }
      if (projectId === "new") {
        selectProject(id);
        newChat();
      } else editProject(null);
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
      drafts.remove(composerDraftKey(null, project.id));
      newChat();
    });
  const files = (project?.files ?? []).filter((file) => !removedFileIds.includes(file.id));
  const fileCount = files.length + pendingFiles.length;
  const totalSize = [...files, ...pendingFiles].reduce((sum, file) => sum + (file.size ?? 0), 0);
  const needle = query.trim().toLowerCase();
  const matches = (fileName: string) => !needle || fileName.toLowerCase().includes(needle);
  const visibleCount =
    files.filter((file) => matches(file.name)).length + pendingFiles.filter((file) => matches(file.name)).length;
  const status = busy
    ? pendingFiles.length
      ? `Uploading ${pendingFiles.length} ${pendingFiles.length === 1 ? "file" : "files"}…`
      : "Saving…"
    : project && hasUnsavedChanges
      ? "Unsaved changes"
      : "";
  return (
    <section
      aria-label={projectId === "new" ? "New project" : "Project settings"}
      className="h-full w-full overflow-y-auto bg-white pt-14 text-neutral-900 md:pt-[3.6875rem] dark:bg-neutral-950 dark:text-neutral-100"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void save();
        }}
      >
        <div className="mx-auto w-full max-w-3xl px-5 pt-6 md:px-10 md:pt-10">
          <header className="mb-8 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
                {projectId === "new" ? "New project" : "Project settings"}
              </h1>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Shared context for every conversation in this project.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close project"
              title="Close project"
              disabled={busy}
              onClick={() => void close()}
              className="-mr-2 shrink-0 rounded-md p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              <X size={16} />
            </button>
          </header>
          <fieldset disabled={busy} className="min-w-0 space-y-10">
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
                  rows={8}
                  className={`${inputClass} min-h-40 resize-y leading-relaxed font-normal`}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Add context, preferences, and goals for every chat in this project…"
                />
              </label>
            </div>
            <section
              aria-label="Shared files"
              className="relative min-w-0"
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
            >
              <div className="mb-1 flex items-center gap-2">
                <h2 className="text-sm font-medium">Shared files</h2>
                {fileCount > 0 && (
                  <span className="text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
                    {fileCount} {fileCount === 1 ? "file" : "files"} · {formatBytes(totalSize)}
                  </span>
                )}
                {fileCount > 0 && (
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="-mr-1.5 ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  >
                    <Plus size={14} />
                    Add files
                  </button>
                )}
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
              {fileCount === 0 ? (
                <button
                  type="button"
                  aria-label="Upload project files"
                  onClick={() => inputRef.current?.click()}
                  className={cn(
                    "flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 transition-colors",
                    dragging
                      ? "border-neutral-500 bg-neutral-100 dark:border-neutral-400 dark:bg-neutral-800"
                      : "border-neutral-200 bg-neutral-50/70 hover:border-neutral-400 hover:bg-neutral-100/60 dark:border-neutral-700 dark:bg-neutral-900/40 dark:hover:border-neutral-500 dark:hover:bg-neutral-800/50",
                  )}
                >
                  <span className="rounded-xl bg-white p-3 text-neutral-500 shadow-sm ring-1 ring-black/5 dark:bg-neutral-800 dark:text-neutral-400 dark:ring-white/5">
                    <Upload size={22} />
                  </span>
                  <span className="text-center">
                    <span className="block text-sm font-medium">
                      {dragging ? "Drop files to add" : "Drop files here or click to browse"}
                    </span>
                    <span className="mt-1 block text-xs text-neutral-400">
                      Documents, images, spreadsheets, and more
                    </span>
                  </span>
                </button>
              ) : (
                <>
                  {(fileCount > FILTER_THRESHOLD || query) && (
                    <label className="relative mb-3 block">
                      <span className="sr-only">Filter files</span>
                      <Search
                        size={15}
                        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400"
                      />
                      <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filter files"
                        className={cn(inputClass, "py-2 pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden")}
                      />
                      {query && (
                        <button
                          type="button"
                          aria-label="Clear filter"
                          onClick={() => setQuery("")}
                          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1.5 text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </label>
                  )}
                  <ul className="divide-y divide-neutral-200/70 overflow-hidden rounded-xl border border-neutral-200/80 dark:divide-neutral-800 dark:border-neutral-800">
                    {/* New files lead the list so they stay visible in long projects. */}
                    {pendingFiles.map(
                      (file, index) =>
                        matches(file.name) && (
                          <FileRow
                            key={`pending-${index}`}
                            name={file.name}
                            contentType={file.type}
                            size={file.size}
                            isNew
                          >
                            <RowAction
                              label={`Remove ${file.name}`}
                              danger
                              onClick={() => setPendingFiles((pending) => pending.filter((_, i) => i !== index))}
                            >
                              <X size={15} />
                            </RowAction>
                          </FileRow>
                        ),
                    )}
                    {files.map(
                      (file) =>
                        matches(file.name) && (
                          <FileRow key={file.id} name={file.name} contentType={file.contentType} size={file.size}>
                            {isAvailable && (
                              <RowAction
                                label={`Open copy of ${file.name}`}
                                title="Open a copy in this chat"
                                onClick={() =>
                                  void run(async () => {
                                    if (!project) return;
                                    if (!(await confirmDiscard())) return;
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
                                <FolderOpen size={15} />
                              </RowAction>
                            )}
                            <RowAction
                              label={`Remove ${file.name}`}
                              danger
                              onClick={() => setRemovedFileIds((removed) => [...removed, file.id])}
                            >
                              <X size={15} />
                            </RowAction>
                          </FileRow>
                        ),
                    )}
                    {visibleCount === 0 && (
                      <li className="px-3 py-6 text-center text-sm text-neutral-400">
                        No files match “{query.trim()}”
                      </li>
                    )}
                  </ul>
                </>
              )}
              {dragging && fileCount > 0 && (
                <div className="pointer-events-none absolute -inset-3 flex justify-center rounded-2xl border-2 border-dashed border-neutral-400 bg-neutral-50/85 dark:border-neutral-500 dark:bg-neutral-950/85">
                  {/* Sticky so the hint stays on screen while dragging over a long list. */}
                  <p className="sticky top-[40vh] my-6 inline-flex h-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium shadow-sm ring-1 ring-black/5 dark:bg-neutral-800 dark:ring-white/10">
                    <Upload size={15} />
                    Drop files to add
                  </p>
                </div>
              )}
            </section>
          </fieldset>
        </div>
        <footer className="sticky bottom-0 z-10 mt-6 bg-white pb-[env(safe-area-inset-bottom)] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-8 before:bg-linear-to-t before:from-white before:to-transparent dark:bg-neutral-950 dark:before:from-neutral-950">
          <div className="mx-auto w-full max-w-3xl px-5 py-4 md:px-10">
            {error && (
              <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              {project && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove()}
                  className="-ml-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  <Trash2 size={15} />
                  Delete project
                </button>
              )}
              <span
                aria-live="polite"
                className="ml-auto hidden truncate text-xs text-neutral-400 sm:block dark:text-neutral-500"
              >
                {status}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void close()}
                className="ml-auto rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 sm:ml-0 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {projectId === "new" ? "Create project" : "Save"}
              </button>
            </div>
          </div>
        </footer>
      </form>
    </section>
  );
}

function FileRow({
  name,
  contentType,
  size,
  isNew,
  children,
}: {
  name: string;
  contentType?: string;
  size?: number;
  isNew?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="group flex items-center gap-3 py-1.5 pr-1.5 pl-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
      <FileIcon name={name} contentType={contentType} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sm" title={name}>
        {name}
      </span>
      {isNew && (
        <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          New
        </span>
      )}
      {/* With a mouse, the row actions take the size's place on hover or focus. */}
      <div className="flex shrink-0 items-center gap-1 pointer-fine:grid pointer-fine:justify-items-end">
        <span className="pr-1.5 text-xs tabular-nums text-neutral-400 transition-opacity pointer-fine:[grid-area:1/1] pointer-fine:group-hover:opacity-0 pointer-fine:group-focus-within:opacity-0 dark:text-neutral-500">
          {formatBytes(size ?? 0)}
        </span>
        <div className="flex items-center transition-opacity pointer-fine:[grid-area:1/1] pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
          {children}
        </div>
      </div>
    </li>
  );
}

function RowAction({
  label,
  title,
  danger,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-neutral-400 transition-colors disabled:cursor-not-allowed",
        danger
          ? "hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
          : "hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200",
      )}
    >
      {children}
    </button>
  );
}
