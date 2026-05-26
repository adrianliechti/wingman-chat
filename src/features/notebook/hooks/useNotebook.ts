import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod/v3";
import { getConfig } from "@/shared/config";
import { run } from "@/shared/lib/agent";
import { convertFileToText } from "@/shared/lib/convert";
import { blobToDataUrl } from "@/shared/lib/opfs-core";
import type { Content } from "@/shared/types/chat";
import type { File } from "@/shared/types/file";
import * as store from "../lib/opfs-notebook";
import {
  type GenerateContext,
  generateArchitecture,
  generateDataCatalog,
  generateHtmlSlides,
  generateImageSlides,
  generateInfographic,
  generateMindMap,
  generatePodcast,
  generateProcess,
  generateQuiz,
  generateText,
} from "../lib/output-generators";
import { createSourceExecTools } from "../lib/source-exec-tools";
import { createSourceTools } from "../lib/source-tools";
import {
  architectureStyles,
  type BuildInstructionsOptions,
  buildInstructions,
  chatInstructions,
  infographicStyles,
  OUTPUT_META,
  podcastStyles,
  processStyles,
  reportStyles,
  slideStyles,
} from "../lib/styles";
import type { Notebook, NotebookMessage, NotebookOutput, OutputType } from "../types/notebook";

export function getSlideStyles() {
  return slideStyles.getAll();
}

export function getPodcastStyles() {
  return podcastStyles.getAll();
}

export function getReportStyles() {
  return reportStyles.getAll();
}

export function getInfographicStyles() {
  return infographicStyles.getAll();
}

export function getProcessStyles() {
  return processStyles.getAll();
}

export function getArchitectureStyles() {
  return architectureStyles.getAll();
}

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Hold a screen wake lock for the duration of a long-running task so the
 * device doesn't sleep / dim mid-generation (a deck or podcast can run for
 * minutes with the user idle). Wake-lock acquisition is best-effort: if the
 * API is unavailable, denied, or auto-released on visibility change, the
 * promise still runs to completion. Mirrors the pattern in
 * `useFieldRecorder.ts` so behaviour stays consistent across the notebook.
 */
async function withScreenWakeLock<T>(task: Promise<T>): Promise<T> {
  let lock: WakeLockSentinel | null = null;
  if (typeof navigator !== "undefined" && navigator.wakeLock) {
    lock = await navigator.wakeLock.request("screen").catch(() => null);
  }
  try {
    return await task;
  } finally {
    if (lock) await lock.release().catch(() => {});
  }
}

const filenameSchema = z.object({ filename: z.string() }).strict();

/** Placeholders the UI passes when the user didn't provide a real name. */
export const PLACEHOLDER_SOURCE_NAMES = {
  pastedText: "Pasted text",
  fieldRecording: "Field Recording",
} as const;

function isPlaceholderName(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return true;
  return Object.values(PLACEHOLDER_SOURCE_NAMES).some((p) => p.toLowerCase() === trimmed);
}

function fallbackNameFromText(text: string): string {
  return text.trim().replace(/\s+/g, " ").split(" ").slice(0, 6).join(" ").slice(0, 50);
}

const EXT_RE = /^[a-z0-9]{1,5}$/i;

/** Split a path into `{prefix, stem, ext}` using the same extension rule as `withDefaultExtension`. */
function splitPath(path: string): { prefix: string; stem: string; ext: string } {
  const slash = path.lastIndexOf("/");
  const prefix = slash >= 0 ? path.slice(0, slash + 1) : "";
  const last = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = last.lastIndexOf(".");
  const hasExt = dot > 0 && EXT_RE.test(last.slice(dot + 1));
  return hasExt ? { prefix, stem: last.slice(0, dot), ext: last.slice(dot) } : { prefix, stem: last, ext: "" };
}

/** Append " (n)" before the extension until the path is unique among `existing`. */
function uniquePath(path: string, existing: Set<string>): string {
  if (!existing.has(path)) return path;
  const { prefix, stem, ext } = splitPath(path);
  let i = 2;
  while (existing.has(`${prefix}${stem} (${i})${ext}`)) i++;
  return `${prefix}${stem} (${i})${ext}`;
}

export function useNotebook(notebookId?: string) {
  const config = getConfig();
  const client = config.client;

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [sources, setSources] = useState<File[]>([]);
  const [outputs, setOutputs] = useState<NotebookOutput[]>([]);
  const [messages, setMessages] = useState<NotebookMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const [isSearching, setIsSearching] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [streamingContent, setStreamingContent] = useState<Content[] | null>(null);

  // Keep a ref to sources so tool closures always see latest
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  // Guard against stale async loads when switching notebooks quickly
  const loadIdRef = useRef(0);

  const getModel = useCallback(() => {
    return config.notebook?.model || "";
  }, [config.notebook]);

  // ── Init / Load ────────────────────────────────────────────────────

  const initNotebook = useCallback(async (id?: string) => {
    const rid = id || generateId();
    const thisLoad = ++loadIdRef.current;
    setLoading(true);

    try {
      const existing = await store.getNotebook(rid);
      // Abort if a newer load was started while we were awaiting
      if (loadIdRef.current !== thisLoad) return rid;

      if (existing) {
        const [s, o, m] = await Promise.all([store.getSources(rid), store.getOutputs(rid), store.getMessages(rid)]);
        if (loadIdRef.current !== thisLoad) return rid;
        setNotebook(existing);
        setSources(s);
        setOutputs(o);
        setMessages(m);
      } else {
        const now = new Date().toISOString();
        const r: Notebook = {
          id: rid,
          title: "Untitled notebook",
          createdAt: now,
          updatedAt: now,
        };
        await store.saveNotebook(r);
        if (loadIdRef.current !== thisLoad) return rid;
        setNotebook(r);
        setSources([]);
        setOutputs([]);
        setMessages([]);
      }
    } finally {
      if (loadIdRef.current === thisLoad) {
        setLoading(false);
      }
    }

    return rid;
  }, []);

  // Keep a ref to current notebook so async flows can read the latest id
  const notebookRef = useRef<Notebook | null>(notebook);
  notebookRef.current = notebook;

  // Lazily create a notebook on first write if none exists yet
  const ensureNotebook = useCallback(async (): Promise<Notebook> => {
    if (notebookRef.current) return notebookRef.current;
    const now = new Date().toISOString();
    const r: Notebook = {
      id: generateId(),
      title: "Untitled notebook",
      createdAt: now,
      updatedAt: now,
    };
    await store.saveNotebook(r);
    notebookRef.current = r;
    setNotebook(r);
    setSources([]);
    setOutputs([]);
    setMessages([]);
    return r;
  }, []);

  // Reset to the empty state (no active notebook)
  const resetNotebook = useCallback(() => {
    loadIdRef.current++;
    notebookRef.current = null;
    setNotebook(null);
    setSources([]);
    setOutputs([]);
    setMessages([]);
    setStreamingContent(null);
  }, []);

  useEffect(() => {
    if (!notebookId) {
      // No id (new/empty state) — reset to blank slate
      loadIdRef.current++;
      notebookRef.current = null;
      setNotebook(null);
      setSources([]);
      setOutputs([]);
      setMessages([]);
      setStreamingContent(null);
      setLoading(false);
      return;
    }
    // Skip reload if we already hold this notebook (e.g. just created via ensureNotebook)
    if (notebookRef.current?.id === notebookId) return;
    // Clear stale data immediately to avoid showing old notebook content
    setNotebook(null);
    initNotebook(notebookId);
  }, [notebookId, initNotebook]);

  // ── Title ──────────────────────────────────────────────────────────

  const updateTitle = useCallback(
    async (title: string) => {
      if (!notebook) return;
      const updated = { ...notebook, title, updatedAt: new Date().toISOString() };
      setNotebook(updated);
      await store.saveNotebook(updated);
    },
    [notebook],
  );

  // ── Sources ────────────────────────────────────────────────────────

  const searchWeb = useCallback(
    async (query: string, mode: "web" | "research"): Promise<string> => {
      setIsSearching(true);

      try {
        if (mode === "research") {
          const content = await client.research("", query);
          if (!content?.trim()) throw new Error("No results found");
          return content;
        }

        const results = await client.search(config.internet?.searcher || "", query);
        const content = results.map((r) => `## ${r.title || r.source || "Result"}\n\n${r.content}`).join("\n\n---\n\n");
        if (!content?.trim()) throw new Error("No results found");
        return content;
      } finally {
        setIsSearching(false);
      }
    },
    [client, config],
  );

  const reservePath = useCallback(
    (path: string, extra?: Iterable<string>): string =>
      uniquePath(path, new Set([...sourcesRef.current.map((s) => s.path), ...(extra ?? [])])),
    [],
  );

  const addSearchResult = useCallback(
    async (query: string, _mode: "web" | "research", content: string) => {
      const nb = await ensureNotebook();

      let path: string;
      try {
        path = store.normalizeSourcePath(query.slice(0, 60)) || generateId();
      } catch {
        path = generateId();
      }
      path = reservePath(store.withDefaultExtension(path, "md"));

      const source: File = { path, content };
      await store.addSource(nb.id, source);
      setSources((prev) => [...prev.filter((s) => s.path !== path), source]);
    },
    [ensureNotebook, reservePath],
  );

  const addFileSource = useCallback(
    async (file: globalThis.File) => {
      const nb = await ensureNotebook();

      let path: string;
      try {
        path = store.normalizeSourcePath(file.name) || generateId();
      } catch {
        path = generateId();
      }
      path = reservePath(path);

      // Images are stored verbatim as binary sources (data URLs) — we don't
      // try to extract text from them. Models with vision can read the content
      // directly, and python tools can open them from the sandbox.
      if (file.type.startsWith("image/")) {
        const dataUrl = await blobToDataUrl(file);
        const source: File = {
          path,
          content: dataUrl,
          contentType: file.type,
        };
        await store.addSource(nb.id, source);
        setSources((prev) => [...prev.filter((s) => s.path !== path), source]);
        return;
      }

      const content = await convertFileToText(file);

      if (!content?.trim()) {
        throw new Error(`Could not extract text from ${file.name}`);
      }

      const source: File = { path, content };
      await store.addSource(nb.id, source);
      store.touchNotebook(nb.id);
      setSources((prev) => [...prev.filter((s) => s.path !== path), source]);
    },
    [ensureNotebook, reservePath],
  );

  const suggestSourceFilename = useCallback(
    async (name: string, text: string): Promise<string> => {
      if (!isPlaceholderName(name)) return name;

      const fallback = fallbackNameFromText(text);
      if (!text.trim()) return fallback || name;

      try {
        const result = await client.parse(
          getModel(),
          "You are naming a text snippet that will be saved as a file in a research notebook. " +
            "Produce a short, descriptive title (3-7 words) that captures the topic. " +
            "Use plain Title Case with spaces — no extension, no quotes, no path separators.",
          text.slice(0, 1500),
          filenameSchema,
          "source_filename",
        );
        const suggested = result?.filename?.trim().replace(/[\\/]/g, " ").slice(0, 80) ?? "";
        return suggested || fallback || name;
      } catch {
        return fallback || name;
      }
    },
    [client, getModel],
  );

  const addTextSource = useCallback(
    async (name: string, text: string, audioUrl?: string): Promise<string> => {
      const nb = await ensureNotebook();

      const displayName = (await suggestSourceFilename(name, text)) || name || PLACEHOLDER_SOURCE_NAMES.pastedText;
      let basePath: string;
      try {
        basePath = store.normalizeSourcePath(displayName) || generateId();
      } catch {
        basePath = generateId();
      }
      const textPath = reservePath(store.withDefaultExtension(basePath, "md"));

      const textSource: File = { path: textPath, content: text };
      await store.addSource(nb.id, textSource);
      const added: File[] = [textSource];

      // Audio companion becomes its own `.wav` source so it lives on the
      // filesystem like any other binary artifact.
      if (audioUrl) {
        const stem = textPath.replace(/\.[a-z0-9]{1,5}$/i, "");
        const audioPath = reservePath(store.withDefaultExtension(stem, "wav"), [textPath]);
        const audioSource: File = {
          path: audioPath,
          content: audioUrl,
          contentType: "audio/wav",
        };
        await store.addSource(nb.id, audioSource);
        added.push(audioSource);
      }

      setSources((prev) => {
        const paths = new Set(added.map((s) => s.path));
        return [...prev.filter((s) => !paths.has(s.path)), ...added];
      });
      return textSource.path;
    },
    [ensureNotebook, reservePath, suggestSourceFilename],
  );

  const scrapeWeb = useCallback(
    async (url: string): Promise<string> => {
      setIsSearching(true);

      try {
        const content = await client.scrape(config.internet?.scraper || "", url);
        if (!content?.trim()) throw new Error("Could not fetch page content");
        return content;
      } finally {
        setIsSearching(false);
      }
    },
    [client, config],
  );

  const addScrapeResult = useCallback(
    async (url: string, content: string) => {
      const nb = await ensureNotebook();

      let path: string;
      try {
        path = store.normalizeSourcePath(url) || generateId();
      } catch {
        path = generateId();
      }
      path = reservePath(store.withDefaultExtension(path, "md"));

      const source: File = { path, content };
      await store.addSource(nb.id, source);
      setSources((prev) => [...prev.filter((s) => s.path !== path), source]);
    },
    [ensureNotebook, reservePath],
  );

  const deleteSource = useCallback(
    async (path: string) => {
      if (!notebook) return;
      await store.removeSource(notebook.id, path);
      setSources((prev) => prev.filter((s) => s.path !== path));
    },
    [notebook],
  );

  const renameSource = useCallback(
    async (oldPath: string, rawNewPath: string) => {
      if (!notebook) return;
      const trimmed = rawNewPath.trim();
      if (!trimmed) throw new Error("Name cannot be empty");

      let newPath: string;
      try {
        newPath = store.normalizeSourcePath(trimmed);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "Invalid name");
      }
      if (!newPath) throw new Error("Name cannot be empty");

      // Preserve the original extension if the user didn't supply one.
      const oldExt = splitPath(oldPath).ext;
      if (oldExt) newPath = store.withDefaultExtension(newPath, oldExt.slice(1));
      if (newPath === oldPath) return;

      const current = sourcesRef.current.find((s) => s.path === oldPath);
      if (!current) throw new Error("Source not found");

      if (sourcesRef.current.some((s) => s.path === newPath)) {
        throw new Error(`A source named "${newPath}" already exists`);
      }

      const renamed: File = current.contentType
        ? { path: newPath, content: current.content, contentType: current.contentType }
        : { path: newPath, content: current.content };

      await store.addSource(notebook.id, renamed);
      await store.removeSource(notebook.id, oldPath);
      setSources((prev) => prev.map((s) => (s.path === oldPath ? renamed : s)));
    },
    [notebook],
  );

  /**
   * Write (or overwrite) a source at the given path. Used by the python/bash
   * execution tools to persist files the sandbox produced back into the
   * notebook. Paths are taken verbatim; content may be utf-8 text or a
   * `data:` URL for binary payloads.
   */
  const writeSource = useCallback(
    async (path: string, content: string, contentType?: string) => {
      if (!notebook) return;
      const source: File = contentType ? { path, content, contentType } : { path, content };
      await store.addSource(notebook.id, source);
      setSources((prev) => [...prev.filter((s) => s.path !== path), source]);
    },
    [notebook],
  );

  // ── Chat ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string) => {
      if (!notebook || isChatting) return;
      setIsChatting(true);
      setStreamingContent(null);

      const userMsg: NotebookMessage = {
        role: "user",
        content: [{ type: "text", text }],
        timestamp: new Date().toISOString(),
      };

      const newMessages = [...messages, userMsg];
      setMessages(newMessages);

      try {
        const tools = [
          ...createSourceTools(() => sourcesRef.current, { onCreate: (path, content) => addTextSource(path, content) }),
          ...createSourceExecTools(() => sourcesRef.current, {
            onWrite: writeSource,
          }),
        ];

        // Build Message[] for the LLM (strip timestamps)
        const conversation = newMessages.map(({ timestamp, ...msg }) => msg);

        const result = await run(client, getModel(), chatInstructions, conversation, tools, {
          agentName: "notebook",
          onStream: (content) => setStreamingContent(content),
        });
        const response = result[result.length - 1];

        setStreamingContent(null);

        const assistantMsg: NotebookMessage = {
          ...response,
          timestamp: new Date().toISOString(),
        };

        const finalMessages = [...newMessages, assistantMsg];
        setMessages(finalMessages);
        await store.saveMessages(notebook.id, finalMessages);
        store.touchNotebook(notebook.id);
      } catch (err) {
        setStreamingContent(null);

        const errorMsg: NotebookMessage = {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Error: ${err instanceof Error ? err.message : "Failed to generate response"}`,
            },
          ],
          timestamp: new Date().toISOString(),
        };
        const finalMessages = [...newMessages, errorMsg];
        setMessages(finalMessages);
      } finally {
        setIsChatting(false);
      }
    },
    [notebook, messages, client, getModel, isChatting, addTextSource, writeSource],
  );

  // ── Outputs ────────────────────────────────────────────────────────

  const generateOutput = useCallback(
    (type: OutputType, styleId?: string, options?: BuildInstructionsOptions) => {
      if (!notebook || sources.length === 0) return;

      const output: NotebookOutput = {
        id: generateId(),
        type,
        title: OUTPUT_META[type].title,
        content: "",
        status: "generating",
        createdAt: new Date().toISOString(),
      };

      setOutputs((prev) => [output, ...prev]);

      const notebookId = notebook.id;

      const task: Promise<Partial<NotebookOutput>> = withScreenWakeLock(
        (async () => {
          const instructions = await buildInstructions(type, styleId, options);
          const ctx: GenerateContext = {
            client,
            model: getModel(),
            instructions,
            sourceTools: createSourceTools(() => sourcesRef.current),
            getSources: () => sourcesRef.current,
            onProgress: (partial) => {
              setOutputs((prev) => prev.map((o) => (o.id === output.id ? { ...o, ...partial } : o)));
            },
          };

          switch (type) {
            case "podcast":
              return generatePodcast(ctx, styleId);
            case "infographic":
              return generateInfographic(ctx);
            case "slides":
              return options?.slideMode === "images" ? generateImageSlides(ctx) : generateHtmlSlides(ctx);
            case "quiz":
              return generateQuiz(ctx);
            case "mindmap":
              return generateMindMap(ctx);
            case "process":
              return generateProcess(ctx, styleId ?? OUTPUT_META.process.defaultStyleId);
            case "architecture":
              return generateArchitecture(ctx);
            case "data-catalog":
              return generateDataCatalog(ctx);
            default:
              return generateText(ctx, OUTPUT_META[type].title);
          }
        })(),
      );

      task
        .then(async (partial) => {
          const completed: NotebookOutput = { ...output, ...partial, status: "completed" };
          setOutputs((prev) => prev.map((o) => (o.id === output.id ? completed : o)));
          await store.addOutput(notebookId, completed);
          store.touchNotebook(notebookId);
        })
        .catch((err) => {
          setOutputs((prev) =>
            prev.map((o) =>
              o.id === output.id
                ? { ...o, status: "error" as const, error: err instanceof Error ? err.message : "Generation failed" }
                : o,
            ),
          );
        });
    },
    [notebook, sources, client, getModel],
  );

  const deleteOutput = useCallback(
    async (outputId: string) => {
      if (!notebook) return;
      await store.removeOutput(notebook.id, outputId);
      setOutputs((prev) => prev.filter((o) => o.id !== outputId));
    },
    [notebook],
  );

  const updateOutput = useCallback(
    async (output: NotebookOutput) => {
      if (!notebook) return;
      setOutputs((prev) => prev.map((o) => (o.id === output.id ? output : o)));
      await store.updateOutput(notebook.id, output);
      store.touchNotebook(notebook.id);
    },
    [notebook],
  );

  return {
    notebook,
    loading,
    sources,
    outputs,
    messages,
    streamingContent,

    isSearching,
    isChatting,

    initNotebook,
    resetNotebook,
    updateTitle,

    searchWeb,
    addSearchResult,
    scrapeWeb,
    addScrapeResult,
    addFileSource,
    addTextSource,
    deleteSource,
    renameSource,
    writeSource,

    sendMessage,

    generateOutput,
    updateOutput,
    deleteOutput,
  };
}
