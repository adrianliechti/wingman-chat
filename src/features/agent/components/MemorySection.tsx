import { Dialog } from "@headlessui/react";
import { Edit, Loader2, Plus, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { confirm } from "@/shared/lib/confirm";
import { flushPersistence } from "@/shared/lib/persistence";
import { Markdown } from "@/shared/ui/Markdown";
import { Section } from "./Section";
import { SectionEmptyState } from "./SectionEmptyState";
import { getMemoryManager } from "../lib/memoryManager";
import { subscribeMemory } from "../lib/memoryEvents";
import {
  isMemoryIndex,
  memoryRevision,
  memoryTitle,
  parseMemoryDocument,
  serializeMemoryDocument,
} from "../lib/memoryDocument";
import { addMemory } from "../lib/memoryCompose";

const button =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 disabled:opacity-40";
const input =
  "w-full rounded-md border border-neutral-300/60 bg-transparent px-3 py-2 text-sm dark:border-neutral-700/60";
type Draft = { kind: "add"; content: string } | { kind: "edit"; path: string; content: string; original: string };

export function MemorySection({ agent }: { agent: Agent }) {
  const { updateAgent } = useAgents();
  const manager = useMemo(() => getMemoryManager(agent.id), [agent.id]);
  const [files, setFiles] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const refresh = useCallback(async () => {
    await flushPersistence();
    const snapshot = await manager.snapshot();
    setLoadError("");
    setFiles(snapshot.files);
    setPending(snapshot.state.jobs.length > 0 || !!snapshot.state.migration);
  }, [manager]);

  useEffect(() => {
    setFiles(new Map());
    setDraft(undefined);
    setSelected("");
    setOpen(false);
    setError("");
    setLoadError("");
    if (!agent.memory) return;
    let active = true;
    const load = () => {
      if (active)
        void refresh().catch((error) => {
          if (active) setLoadError(error instanceof Error ? error.message : String(error));
        });
    };
    load();
    const unsubscribe = subscribeMemory(agent.id, load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [agent.id, agent.memory, refresh]);

  const notes = [...files].filter(([path]) => !isMemoryIndex(path)).sort(([a], [b]) => a.localeCompare(b));
  const selectedPath = notes.some(([path]) => path === selected) ? selected : (notes[0]?.[0] ?? "");
  const content = files.get(selectedPath);
  const doc = content === undefined ? undefined : parseMemoryDocument(content);
  const sources = Array.isArray(doc?.metadata.sources) ? doc.metadata.sources : [];
  const displayError = error || loadError;
  const operate = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await flushPersistence();
      await action();
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
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
    setBusy(true);
    if (
      !(await confirm({
        title: all ? "Clear all memory?" : "Forget this memory?",
        message: all
          ? "All saved memories for this agent will be removed. Existing conversations are kept."
          : "This memory will be removed. Existing conversations are kept.",
        confirmLabel: all ? "Clear all" : "Forget",
        danger: true,
      }))
    ) {
      setBusy(false);
      return;
    }
    await operate(async () => {
      const targets = all ? [...files] : [[path, files.get(path)!]];
      const observed = new Map(
        await Promise.all(targets.map(async ([path, text]) => [path, await memoryRevision(text)] as const)),
      );
      await manager.remove(all ? "/.memory" : `/.memory/${path}`, observed);
      if (all || selectedPath === path) setSelected("");
      if (all || (draft?.kind === "edit" && draft.path === path)) setDraft(undefined);
    });
  };
  const choose = (path: string) => {
    setSelected(path);
    setDraft(undefined);
    setError("");
  };

  return (
    <>
      <Section
        title="Memory"
        isOpen
        collapsible={false}
        headerAction={
          <button
            type="button"
            onClick={() => updateAgent(agent.id, { memory: !agent.memory })}
            className={agent.memory ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400"}
            aria-label={agent.memory ? "Disable memory" : "Enable memory"}
          >
            {agent.memory ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
          </button>
        }
      >
        {agent.memory ? (
          <div className="space-y-3">
            <SectionEmptyState
              icon={<Edit size={12} />}
              label={notes.length ? `${notes.length} memories` : "No memories yet"}
              description={
                notes.length
                  ? "View, edit, or forget what this agent remembers"
                  : "Learns useful preferences and decisions from conversations"
              }
              onClick={() => {
                setOpen(true);
                void refresh().catch((error) => setLoadError(error instanceof Error ? error.message : String(error)));
              }}
            />
            {displayError && !open && (
              <p role="alert" className="text-xs text-red-600">
                {displayError}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-neutral-400">Enable to remember useful context across conversations.</p>
        )}
      </Section>
      <Dialog
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        className="relative z-80"
      >
        <div className="fixed inset-0 bg-black/40" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white text-neutral-900 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
            <div className="flex items-center justify-between border-b border-neutral-200/60 px-5 py-3 dark:border-neutral-800">
              <Dialog.Title className="font-semibold">Memory</Dialog.Title>
              <div className="flex items-center gap-1">
                <button
                  className={button}
                  aria-label="Clear all memory"
                  title="Clear all memory"
                  disabled={busy || (!files.size && !pending)}
                  onClick={() => void remove()}
                >
                  <Trash2 size={16} />
                </button>
                <button
                  className={button}
                  aria-label="Add memory"
                  title="Add memory"
                  disabled={busy}
                  onClick={() => {
                    setDraft({ kind: "add", content: "" });
                    setError("");
                  }}
                >
                  <Plus size={16} />
                </button>
                <button className={button} aria-label="Close memory" disabled={busy} onClick={() => setOpen(false)}>
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex min-h-80 min-w-0 flex-1 flex-col overflow-hidden sm:flex-row">
              {notes.length > 0 && (
                <nav
                  aria-label="Memory notes"
                  className="max-h-44 overflow-auto border-b border-neutral-200/60 p-2 sm:max-h-none sm:w-56 sm:shrink-0 sm:border-r sm:border-b-0 dark:border-neutral-800"
                >
                  {notes.map(([path, text]) => {
                    const title = memoryTitle(path, parseMemoryDocument(text));
                    return (
                      <div
                        key={path}
                        className={`group flex items-center rounded-md ${!draft && selectedPath === path ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
                      >
                        <button
                          className={`${button} min-w-0 flex-1 text-left`}
                          disabled={busy}
                          onClick={() => choose(path)}
                          aria-current={!draft && selectedPath === path ? "page" : undefined}
                          title={title}
                        >
                          <span className="truncate">{title}</span>
                        </button>
                        <button
                          className="mr-1 shrink-0 rounded p-1.5 text-neutral-500 hover:bg-neutral-200/60 hover:text-red-600 focus-visible:opacity-100 disabled:opacity-40 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 dark:hover:bg-neutral-800/60"
                          aria-label={`Forget ${title}`}
                          title="Forget memory"
                          disabled={busy}
                          onClick={() => void remove(path)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </nav>
              )}
              <div className="min-w-0 flex-1 overflow-auto p-5">
                {draft ? (
                  <div className="space-y-3">
                    <label htmlFor="memory-text" className="block text-sm font-medium">
                      {draft.kind === "add" ? "What should this agent remember?" : "Edit memory"}
                    </label>
                    <textarea
                      id="memory-text"
                      aria-label={draft.kind === "add" ? "Memory to remember" : "Memory content"}
                      autoFocus
                      rows={8}
                      className={`${input} min-h-48 resize-y`}
                      placeholder={
                        draft.kind === "add"
                          ? "For example, I prefer concise answers with concrete examples."
                          : undefined
                      }
                      value={draft.content}
                      disabled={busy}
                      onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                      onKeyDown={(event) => {
                        if (
                          !busy &&
                          draft.content.trim() &&
                          event.key === "Enter" &&
                          (event.metaKey || event.ctrlKey)
                        ) {
                          event.preventDefault();
                          void save();
                        }
                      }}
                    />
                    {draft.kind === "add" && (
                      <p className="text-xs text-neutral-500">
                        Write naturally. The agent will organize this into memories.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {doc ? (
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <h3>{memoryTitle(selectedPath, doc)}</h3>
                        <Markdown>{doc.body}</Markdown>
                      </div>
                    ) : (
                      <div className="py-12 text-center">
                        <p className="text-sm font-medium">No memories yet</p>
                        <p className="mt-2 text-sm text-neutral-500">
                          Add a memory, or let this agent learn from conversations.
                        </p>
                      </div>
                    )}
                    {doc && (
                      <div className="mt-5 space-y-2 text-xs text-neutral-500">
                        {typeof doc.metadata.wingman_evidence === "string" && <p>{doc.metadata.wingman_evidence}</p>}
                        {sources.length > 0 && <p>Sources</p>}
                        {sources.map((source, i) => {
                          const resource = String(source.resource);
                          const chat = resource.match(/^wingman:\/\/chats\/([^/]+)\//);
                          const href = chat
                            ? `/chat/${chat[1]}`
                            : /^https?:\/\//i.test(resource)
                              ? resource
                              : undefined;
                          return (
                            <p key={i}>
                              {href ? (
                                <a className="underline" href={href} target="_blank" rel="noreferrer">
                                  {String(source.title ?? (chat ? "Conversation" : resource))}
                                </a>
                              ) : (
                                resource
                              )}
                            </p>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
                {displayError && (
                  <p role="alert" className="mt-3 text-sm text-red-600">
                    {displayError}
                  </p>
                )}
              </div>
            </div>
            {(draft || doc) && (
              <div className="flex items-center justify-end border-t border-neutral-200/60 px-4 py-3 dark:border-neutral-800">
                <div className="flex gap-1">
                  {draft ? (
                    <>
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => {
                          setDraft(undefined);
                          setError("");
                        }}
                      >
                        Cancel
                      </button>
                      <button className={button} disabled={busy || !draft.content.trim()} onClick={() => void save()}>
                        {busy && <Loader2 size={13} className="animate-spin" />}
                        {draft.kind === "add" ? (busy ? "Remembering…" : "Remember") : "Save"}
                      </button>
                    </>
                  ) : doc && content !== undefined ? (
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => {
                        setDraft({ kind: "edit", path: selectedPath, content: doc.body, original: content });
                        setError("");
                      }}
                    >
                      <Edit size={13} /> Edit
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </Dialog.Panel>
        </div>
      </Dialog>
    </>
  );
}
