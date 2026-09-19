import { Dialog, Transition } from "@headlessui/react";
import {
  ArrowLeft,
  BrainCircuit,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Settings2,
  StickyNote,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import { flushPersistence } from "@/shared/lib/persistence";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { Markdown } from "@/shared/ui/Markdown";
import { Tooltip } from "@/shared/ui/Tooltip";
import { Section } from "./Section";
import { getMemoryManager } from "../lib/memoryManager";
import { subscribeMemory } from "../lib/memoryEvents";
import {
  isMemoryIndex,
  type MemoryDocument,
  memoryRevision,
  memoryTitle,
  parseMemoryDocument,
  serializeMemoryDocument,
} from "../lib/memoryDocument";
import { addMemory } from "../lib/memoryCompose";

const MEMORY_HINT = "Learns preferences and decisions from conversations and recalls them later.";

// Shared with the other agent dialogs so buttons line up across the drawer.
const iconButton =
  "shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-300";
const secondaryButton =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200/60 disabled:pointer-events-none disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800/60";
const primaryButton =
  "inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40 dark:bg-neutral-200 dark:text-neutral-900";
const pill =
  "inline-flex items-center rounded-full border border-neutral-200 bg-neutral-100/60 px-1.5 py-px text-[10px] font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400";
const warnPill =
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400";
const textareaClass =
  "min-h-48 w-full resize-y rounded-md border border-neutral-300/60 bg-white/50 px-3 py-2 text-sm text-neutral-900 backdrop-blur-sm transition-colors focus:border-transparent focus:ring-2 focus:ring-neutral-500/60 dark:border-neutral-700/60 dark:bg-neutral-800/50 dark:text-neutral-100";
const groupLabel = "text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500";
const paneHeader =
  "flex h-12 shrink-0 items-center gap-1 border-b border-neutral-200/60 pl-5 pr-3 dark:border-neutral-800/60";

type Draft = { kind: "add"; content: string } | { kind: "edit"; path: string; content: string; original: string };
type Pending = "" | "learning" | "organizing";

interface Note {
  path: string;
  content: string;
  doc: MemoryDocument;
  title: string;
  folder: string;
}

function readNote(path: string, content: string): Note {
  let doc: MemoryDocument;
  try {
    doc = parseMemoryDocument(content);
  } catch {
    doc = { metadata: { type: "Reference" }, body: content };
  }
  const slash = path.indexOf("/");
  return { path, content, doc, title: memoryTitle(path, doc), folder: slash === -1 ? "" : path.slice(0, slash) };
}

const folderLabel = (folder: string) =>
  folder ? folder.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "General";

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();

const pendingLabel = (pending: Pending) =>
  pending === "learning" ? "Learning from recent conversations…" : "Organizing memories…";

function sourceLink(source: Record<string, unknown>) {
  const resource = String(source.resource);
  const chat = resource.match(/^wingman:\/\/chats\/([^/]+)\//);
  const href = chat ? `/chat/${chat[1]}` : /^https?:\/\//i.test(resource) ? resource : undefined;
  const label = typeof source.title === "string" ? source.title : chat ? "Conversation" : resource;
  return { href, label };
}

function NoteBadges({ doc }: { doc: MemoryDocument }) {
  const { type, scope, core, status, stale_after: staleAfter, tags } = doc.metadata;
  const badges: { label: string; warn?: boolean }[] = [];
  if (typeof type === "string") badges.push({ label: type });
  if (typeof scope === "string" && scope) badges.push({ label: scope });
  if (core === true) badges.push({ label: "Core" });
  if (status === "draft" || status === "deprecated") badges.push({ label: status, warn: true });
  if (typeof staleAfter === "string" && Date.parse(staleAfter) <= Date.now())
    badges.push({ label: "expired", warn: true });
  if (Array.isArray(tags)) for (const tag of tags) if (typeof tag === "string") badges.push({ label: `#${tag}` });
  if (!badges.length) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-1">
      {badges.map((badge, i) => (
        <span key={i} className={cn(pill, badge.warn && warnPill)}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}

export function MemorySection({ agent }: { agent: Agent }) {
  const { updateAgent } = useAgents();
  const manager = useMemo(() => getMemoryManager(agent.id), [agent.id]);
  const [files, setFiles] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  // Small screens show either the note list or the selected note.
  const [pane, setPane] = useState<"list" | "detail">("list");
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>("");

  const refresh = useCallback(async () => {
    await flushPersistence();
    const snapshot = await manager.snapshot();
    setLoadError("");
    setFiles(snapshot.files);
    setPending(snapshot.state.jobs.length > 0 ? "learning" : snapshot.state.migration ? "organizing" : "");
  }, [manager]);

  useEffect(() => {
    setFiles(new Map());
    setDraft(undefined);
    setSelected("");
    setPane("list");
    setOpen(false);
    setError("");
    setLoadError("");
    if (!agent.memory) return;
    let active = true;
    const load = () => {
      if (active)
        void refresh().catch((error) => {
          if (active) setLoadError(describe(error));
        });
    };
    load();
    const unsubscribe = subscribeMemory(agent.id, load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [agent.id, agent.memory, refresh]);

  const notes = useMemo(
    () =>
      [...files]
        .filter(([path]) => !isMemoryIndex(path))
        .map(([path, content]) => readNote(path, content))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [files],
  );
  const groups = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const note of notes) map.set(note.folder, [...(map.get(note.folder) ?? []), note]);
    return [...map];
  }, [notes]);
  const grouped = groups.some(([folder]) => folder);
  const note = notes.find((n) => n.path === selected) ?? notes[0];
  const displayError = error || loadError;
  const detailOnMobile = !!draft || pane === "detail" || notes.length === 0;

  const load = () => void refresh().catch((error) => setLoadError(describe(error)));
  const openDialog = (path?: string) => {
    setDraft(undefined);
    setError("");
    if (path) setSelected(path);
    setPane(path ? "detail" : "list");
    setOpen(true);
    load();
  };
  const closeDialog = () => {
    if (busy) return;
    setOpen(false);
    setDraft(undefined);
    setError("");
  };
  const showList = () => {
    setDraft(undefined);
    setError("");
    setPane("list");
  };
  const choose = (path: string) => {
    setSelected(path);
    setDraft(undefined);
    setError("");
    setPane("detail");
  };
  const startAdd = () => {
    setDraft({ kind: "add", content: "" });
    setError("");
  };
  const startEdit = () => {
    if (!note) return;
    setDraft({ kind: "edit", path: note.path, content: note.doc.body, original: note.content });
    setError("");
  };
  const cancelDraft = () => {
    setDraft(undefined);
    setError("");
  };
  const toggle = () => updateAgent(agent.id, { memory: !agent.memory });

  const operate = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await flushPersistence();
      await action();
      await refresh();
    } catch (error) {
      setError(describe(error));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    operate(async () => {
      if (!draft) return;
      if (draft.kind === "add") {
        const paths = await addMemory(manager, draft.content);
        setSelected(paths[0]);
        setPane("detail");
      } else {
        const original = parseMemoryDocument(draft.original);
        await manager.write(
          `/.memory/${draft.path}`,
          serializeMemoryDocument({ ...original, body: draft.content }),
          await memoryRevision(draft.original),
        );
        setSelected(draft.path);
      }
      setDraft(undefined);
    });
  const remove = async (path?: string) => {
    const all = path === undefined;
    const title = all ? "" : (notes.find((n) => n.path === path)?.title ?? path);
    setBusy(true);
    if (
      !(await confirm({
        title: all ? "Clear all memory?" : "Forget this memory?",
        message: all
          ? "All saved memories for this agent will be removed. Existing conversations are kept."
          : `"${title}" will be removed. Existing conversations are kept.`,
        confirmLabel: all ? "Clear all" : "Forget",
        danger: true,
      }))
    ) {
      setBusy(false);
      return;
    }
    await operate(async () => {
      const targets = all ? [...files] : [[path, files.get(path) ?? ""] as const];
      const observed = new Map(
        await Promise.all(targets.map(async ([path, text]) => [path, await memoryRevision(text)] as const)),
      );
      await manager.remove(all ? "/.memory" : `/.memory/${path}`, observed);
      if (all || selected === path) setSelected("");
      if (all || (draft?.kind === "edit" && draft.path === path)) setDraft(undefined);
    });
  };

  // Learned notes often repeat the first sentence of the body as their description; show it only when it adds something.
  const rawDescription = typeof note?.doc.metadata.description === "string" ? note.doc.metadata.description : "";
  const description =
    rawDescription && note && !normalize(note.doc.body).startsWith(normalize(rawDescription)) ? rawDescription : "";
  const evidence = typeof note?.doc.metadata.wingman_evidence === "string" ? note.doc.metadata.wingman_evidence : "";
  const sources = Array.isArray(note?.doc.metadata.sources)
    ? (note.doc.metadata.sources as Record<string, unknown>[])
    : [];
  const errorLine = displayError ? (
    <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
      {displayError}
    </p>
  ) : null;

  return (
    <>
      <Section
        title="Memory"
        count={notes.length}
        isOpen
        collapsible={false}
        headerAction={
          agent.memory ? (
            <button
              type="button"
              onClick={() => openDialog()}
              className="flex items-center gap-1 text-xs text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
            >
              <Settings2 size={12} /> Manage
            </button>
          ) : null
        }
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2 py-1.5">
            <button
              type="button"
              onClick={toggle}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
            >
              <Tooltip content={MEMORY_HINT} side="left" className="inline-flex min-w-0 items-center gap-2">
                <div
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center text-neutral-600 dark:text-neutral-400",
                    !agent.memory && "opacity-40",
                  )}
                >
                  <BrainCircuit size={13} />
                </div>
                <span
                  className={cn(
                    "min-w-0 truncate text-xs",
                    agent.memory
                      ? "font-medium text-neutral-900 dark:text-neutral-100"
                      : "text-neutral-500 dark:text-neutral-400",
                  )}
                >
                  Remember across conversations
                </span>
              </Tooltip>
            </button>
            <button
              type="button"
              onClick={toggle}
              aria-label={agent.memory ? "Disable memory" : "Enable memory"}
              className={cn(
                "shrink-0",
                agent.memory ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500",
              )}
            >
              {agent.memory ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
            </button>
          </div>

          {agent.memory && pending ? (
            <p className="flex items-center gap-1.5 px-1 text-[10px] text-neutral-400 dark:text-neutral-500">
              <Loader2 size={10} className="animate-spin" /> {pendingLabel(pending)}
            </p>
          ) : (
            <p className="px-1 text-[10px] text-neutral-400 dark:text-neutral-500">{MEMORY_HINT}</p>
          )}
          {displayError && !open && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {displayError}
            </p>
          )}
        </div>
      </Section>

      <Transition appear show={open} as={Fragment}>
        <Dialog as="div" className="relative z-80" onClose={closeDialog}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40 dark:bg-black/60" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center sm:items-center sm:p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              >
                <Dialog.Panel className="relative flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white/95 shadow-xl backdrop-blur-xl sm:h-[75dvh] sm:max-w-3xl sm:rounded-xl sm:border sm:border-neutral-200/50 dark:bg-neutral-900/95 dark:sm:border-neutral-700/50">
                  {/* ── Top bar ── */}
                  <div className="flex h-12 shrink-0 items-center gap-1 border-b border-neutral-200/60 pr-3 pl-3 sm:pl-4 dark:border-neutral-800/60">
                    {detailOnMobile && notes.length > 0 && (
                      <button
                        type="button"
                        onClick={showList}
                        disabled={busy}
                        title="Back to list"
                        aria-label="Back to list"
                        className="shrink-0 rounded-md p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 sm:hidden dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                      >
                        <ArrowLeft size={18} />
                      </button>
                    )}
                    <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      Memory
                    </Dialog.Title>
                    <button
                      type="button"
                      className={iconButton}
                      aria-label="Add memory"
                      title="Add memory"
                      disabled={busy}
                      onClick={startAdd}
                    >
                      <Plus size={15} />
                    </button>
                    <button
                      type="button"
                      className={iconButton}
                      aria-label="Clear all memory"
                      title="Clear all memory"
                      disabled={busy || (!files.size && !pending)}
                      onClick={() => void remove()}
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      type="button"
                      className={cn(iconButton, "ml-1")}
                      aria-label="Close memory"
                      title="Close"
                      disabled={busy}
                      onClick={closeDialog}
                    >
                      <X size={15} />
                    </button>
                  </div>

                  {/* ── Body ── */}
                  <div className="flex min-h-0 flex-1 overflow-hidden">
                    {notes.length > 0 && (
                      <nav
                        aria-label="Memory notes"
                        className={cn(
                          "w-full shrink-0 flex-col overflow-y-auto border-neutral-200/60 bg-neutral-50/80 p-2 sm:flex sm:w-52 sm:border-r dark:border-neutral-800/60 dark:bg-neutral-950/20",
                          detailOnMobile ? "hidden" : "flex",
                        )}
                      >
                        {groups.map(([folder, items]) => (
                          <div key={folder} className="mb-2 last:mb-0">
                            {grouped && <p className={cn(groupLabel, "px-2 pt-1 pb-1")}>{folderLabel(folder)}</p>}
                            <ul className="space-y-px">
                              {items.map((n) => {
                                const active = !draft && note?.path === n.path;
                                return (
                                  <li key={n.path} className="group/row relative flex items-center">
                                    <button
                                      type="button"
                                      onClick={() => choose(n.path)}
                                      disabled={busy}
                                      aria-current={active ? "page" : undefined}
                                      title={n.title}
                                      className={cn(
                                        "flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md py-1 pr-8 pl-2 text-left transition-colors hover:bg-neutral-200/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-400 disabled:opacity-40 dark:hover:bg-neutral-800/50",
                                        active && "bg-neutral-200/40 dark:bg-neutral-800/50",
                                      )}
                                    >
                                      <StickyNote
                                        size={14}
                                        className="shrink-0 text-neutral-400 dark:text-neutral-500"
                                      />
                                      <span
                                        className={cn(
                                          "block min-w-0 flex-1 truncate text-[13px] leading-5",
                                          active
                                            ? "font-medium text-neutral-900 dark:text-neutral-100"
                                            : "text-neutral-600 dark:text-neutral-300",
                                        )}
                                      >
                                        {n.title}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void remove(n.path)}
                                      disabled={busy}
                                      title="Forget memory"
                                      aria-label={`Forget ${n.title}`}
                                      className="absolute right-1.5 rounded p-1 text-neutral-400 transition-opacity hover:text-neutral-700 disabled:opacity-40 md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100 dark:hover:text-neutral-200"
                                    >
                                      <X size={12} />
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ))}
                      </nav>
                    )}

                    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !detailOnMobile && "max-sm:hidden")}>
                      {draft ? (
                        <>
                          <div className={cn(paneHeader, "pr-5")}>
                            <p className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                              {draft.kind === "add" ? "New memory" : note?.title}
                            </p>
                            {draft.kind === "edit" && <span className={pill}>Editing</span>}
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                            <textarea
                              aria-label={draft.kind === "add" ? "Memory to remember" : "Memory content"}
                              autoFocus
                              rows={8}
                              className={textareaClass}
                              placeholder={
                                draft.kind === "add"
                                  ? "For example: I prefer concise answers with concrete examples."
                                  : undefined
                              }
                              value={draft.content}
                              disabled={busy}
                              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  if (!busy) cancelDraft();
                                } else if (
                                  event.key === "Enter" &&
                                  (event.metaKey || event.ctrlKey) &&
                                  !busy &&
                                  draft.content.trim()
                                ) {
                                  event.preventDefault();
                                  void save();
                                }
                              }}
                            />
                            {draft.kind === "add" && (
                              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                                Write naturally. The agent organizes this into memories.
                              </p>
                            )}
                            {errorLine}
                          </div>
                          <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-neutral-200/60 bg-neutral-50/50 px-5 py-3 dark:border-neutral-800/60 dark:bg-neutral-900/30">
                            <button type="button" className={secondaryButton} disabled={busy} onClick={cancelDraft}>
                              Cancel
                            </button>
                            <button
                              type="button"
                              className={primaryButton}
                              disabled={busy || !draft.content.trim()}
                              onClick={() => void save()}
                            >
                              {busy && <Loader2 size={12} className="animate-spin" />}
                              {draft.kind === "add" ? (busy ? "Remembering…" : "Remember") : "Save"}
                            </button>
                          </div>
                        </>
                      ) : note ? (
                        <>
                          <div className={paneHeader}>
                            <p
                              className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100"
                              title={note.title}
                            >
                              {note.title}
                            </p>
                            <button
                              type="button"
                              className={iconButton}
                              aria-label="Edit"
                              title="Edit memory"
                              disabled={busy}
                              onClick={startEdit}
                            >
                              <Pencil size={15} />
                            </button>
                            <DropdownMenu
                              anchor="bottom end"
                              trigger={
                                <MenuButton
                                  className={iconButton}
                                  aria-label="More options"
                                  title="More options"
                                  disabled={busy}
                                >
                                  <MoreVertical size={15} />
                                </MenuButton>
                              }
                            >
                              <DropdownMenuItem
                                icon={<Trash2 size={13} />}
                                destructive
                                onClick={() => void remove(note.path)}
                              >
                                Forget
                              </DropdownMenuItem>
                            </DropdownMenu>
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                            <NoteBadges doc={note.doc} />
                            {description && (
                              <div className="mb-4">
                                <p className={cn(groupLabel, "mb-1")}>Description</p>
                                <p className="text-sm text-neutral-700 dark:text-neutral-300">{description}</p>
                              </div>
                            )}
                            <div className="prose prose-sm prose-neutral max-w-none text-sm dark:prose-invert [&>*:first-child]:mt-0">
                              <Markdown>{note.doc.body}</Markdown>
                            </div>
                            {(evidence || sources.length > 0) && (
                              <div className="mt-5 border-t border-neutral-200/60 pt-4 dark:border-neutral-800/60">
                                <p className={cn(groupLabel, "mb-1.5")}>Sources</p>
                                {evidence && (
                                  <p className="mb-1.5 text-xs text-neutral-500 dark:text-neutral-400">{evidence}</p>
                                )}
                                <ul className="space-y-1">
                                  {sources.map((source, i) => {
                                    const { href, label } = sourceLink(source);
                                    return (
                                      <li key={i} className="text-xs text-neutral-500 dark:text-neutral-400">
                                        {href ? (
                                          <a
                                            className="underline decoration-neutral-300 underline-offset-2 transition-colors hover:text-neutral-900 dark:decoration-neutral-600 dark:hover:text-neutral-100"
                                            href={href}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            {label}
                                          </a>
                                        ) : (
                                          label
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            )}
                            {errorLine}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-800/80">
                            <BrainCircuit size={24} className="text-neutral-400 dark:text-neutral-500" />
                          </div>
                          <h3 className="mb-1 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                            No memories yet
                          </h3>
                          <p className="mb-5 max-w-xs text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                            {pending
                              ? pendingLabel(pending)
                              : "Add a memory, or let this agent learn from conversations."}
                          </p>
                          <button type="button" className={primaryButton} disabled={busy} onClick={startAdd}>
                            <Plus size={12} /> Add your first memory
                          </button>
                          {errorLine}
                        </div>
                      )}
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}
