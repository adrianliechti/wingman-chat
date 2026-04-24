import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig } from "@/shared/config";
import { convertFileToText } from "@/shared/lib/convert";
import { blobToDataUrl } from "@/shared/lib/opfs-core";
import type { Content } from "@/shared/types/chat";
import { getTextFromContent } from "@/shared/types/chat";
import * as store from "../lib/opfs-notebook";
import { createSourceTools } from "../lib/source-tools";
import { runWithTools } from "../lib/tool-loop";
import chatInstructions from "../prompts/chat.txt?raw";
import infographicStyleAnime from "../prompts/infographic-style-anime.txt?raw";
import infographicStyleAuto from "../prompts/infographic-style-auto.txt?raw";
import infographicStyleBento from "../prompts/infographic-style-bento.txt?raw";
import infographicStyleBricks from "../prompts/infographic-style-bricks.txt?raw";
import infographicStyleClay from "../prompts/infographic-style-clay.txt?raw";
import infographicStyleEditorial from "../prompts/infographic-style-editorial.txt?raw";
import infographicStyleInstructional from "../prompts/infographic-style-instructional.txt?raw";
import infographicStyleKawaii from "../prompts/infographic-style-kawaii.txt?raw";
import infographicStyleProfessional from "../prompts/infographic-style-professional.txt?raw";
import infographicStyleScientific from "../prompts/infographic-style-scientific.txt?raw";
import infographicStyleSketchNote from "../prompts/infographic-style-sketch-note.txt?raw";
import podcastStyleBriefing from "../prompts/podcast-style-briefing.txt?raw";
import podcastStyleDebate from "../prompts/podcast-style-debate.txt?raw";
import podcastStyleDeepDive from "../prompts/podcast-style-deep-dive.txt?raw";
import podcastStyleOverview from "../prompts/podcast-style-overview.txt?raw";
import podcastStyleStory from "../prompts/podcast-style-story.txt?raw";
import reportStyleDashboard from "../prompts/report-style-dashboard.txt?raw";
import reportStyleExecutive from "../prompts/report-style-executive.txt?raw";
import reportStyleMagazine from "../prompts/report-style-magazine.txt?raw";
import reportStyleResearch from "../prompts/report-style-research.txt?raw";
import slideCommonRules from "../prompts/slide-style-common.txt?raw";
import slideStyleConsulting from "../prompts/slide-style-consulting.txt?raw";
import slideStyleDark from "../prompts/slide-style-dark.txt?raw";
import slideStyleNature from "../prompts/slide-style-nature.txt?raw";
import slideStyleSwiss from "../prompts/slide-style-swiss.txt?raw";
import slideStyleWhiteboard from "../prompts/slide-style-whiteboard.txt?raw";
import studioAudioInstructions from "../prompts/studio-audio-overview.txt?raw";
import studioInfographicInstructions from "../prompts/studio-infographic.txt?raw";
import studioMindMapInstructions from "../prompts/studio-mind-map.txt?raw";
import studioQuizInstructions from "../prompts/studio-quiz.txt?raw";
import studioReportInstructions from "../prompts/studio-report.txt?raw";
import studioSlideInstructions from "../prompts/studio-slide-deck.txt?raw";
import type {
  MindMapNode,
  Notebook,
  NotebookMessage,
  NotebookOutput,
  NotebookSource,
  OutputType,
  QuizQuestion,
} from "../types/notebook";

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Merge multiple WAV blobs into a single WAV blob.
 * Assumes all blobs are PCM WAV with the same sample rate and format.
 */
async function mergeWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];

  const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));

  // Read header from first WAV to get format info
  const firstView = new DataView(buffers[0]);
  const numChannels = firstView.getUint16(22, true);
  const sampleRate = firstView.getUint32(24, true);
  const bitsPerSample = firstView.getUint16(34, true);

  // Extract raw PCM data from each WAV (skip 44-byte header)
  const pcmChunks: ArrayBuffer[] = [];
  let totalDataSize = 0;
  for (const buf of buffers) {
    const dataStart = 44;
    const chunk = buf.slice(dataStart);
    pcmChunks.push(chunk);
    totalDataSize += chunk.byteLength;
  }

  // Build new WAV
  const headerSize = 44;
  const result = new ArrayBuffer(headerSize + totalDataSize);
  const view = new DataView(result);
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + totalDataSize, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, totalDataSize, true);

  // Copy PCM data
  const output = new Uint8Array(result);
  let offset = headerSize;
  for (const chunk of pcmChunks) {
    output.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return new Blob([result], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

const STUDIO_PROMPTS: Record<OutputType, string> = {
  podcast: studioAudioInstructions,
  slides: studioSlideInstructions,
  infographic: studioInfographicInstructions,
  report: studioReportInstructions,
  quiz: studioQuizInstructions,
  mindmap: studioMindMapInstructions,
};

type SlideStyle = { id: string; label: string; prompt: string };
type PodcastStyle = { id: string; label: string; prompt: string; voices: string[] };
type ReportStyle = { id: string; label: string; prompt: string };

const DEFAULT_SLIDE_STYLES: SlideStyle[] = [
  { id: "whiteboard", label: "Whiteboard", prompt: slideStyleWhiteboard },
  { id: "consulting", label: "Consulting", prompt: slideStyleConsulting },
  { id: "dark", label: "Dark", prompt: slideStyleDark },
  { id: "swiss", label: "Swiss", prompt: slideStyleSwiss },
  { id: "nature", label: "Nature", prompt: slideStyleNature },
];

export function getSlideStyles(): SlideStyle[] {
  const config = getConfig();
  const slides = config.canvas?.slides;

  if (slides && slides.length > 0) {
    return slides.map((s) => ({
      id: s.name.toLowerCase().replace(/\s+/g, "-"),
      label: s.name,
      prompt: s.prompt,
    }));
  }

  return DEFAULT_SLIDE_STYLES;
}

const DEFAULT_PODCAST_STYLES: PodcastStyle[] = [
  { id: "overview", label: "Overview", prompt: podcastStyleOverview, voices: ["host"] },
  { id: "deep-dive", label: "Deep Dive", prompt: podcastStyleDeepDive, voices: ["analyst"] },
  { id: "briefing", label: "Briefing", prompt: podcastStyleBriefing, voices: ["narrator"] },
  { id: "story", label: "Story", prompt: podcastStyleStory, voices: ["storyteller"] },
  { id: "debate", label: "Debate", prompt: podcastStyleDebate, voices: ["host", "skeptic"] },
];

export function getPodcastStyles(): PodcastStyle[] {
  const config = getConfig();
  const podcasts = config.canvas?.podcasts;

  if (podcasts && podcasts.length > 0) {
    return podcasts.map((p) => ({
      id: p.name.toLowerCase().replace(/\s+/g, "-"),
      label: p.name,
      prompt: p.prompt,
      voices: p.voices ?? ["host"],
    }));
  }

  return DEFAULT_PODCAST_STYLES;
}

function buildSlideInstructions(styleId: string): string {
  const slideStyles = getSlideStyles();
  const style = slideStyles.find((s) => s.id === styleId) ?? slideStyles[0] ?? DEFAULT_SLIDE_STYLES[0];
  return studioSlideInstructions
    .replace("{{COMMON_RULES}}", slideCommonRules)
    .replace("{{STYLE_SECTION}}", style.prompt);
}

const DEFAULT_REPORT_STYLES: ReportStyle[] = [
  { id: "executive", label: "Executive", prompt: reportStyleExecutive },
  { id: "dashboard", label: "Dashboard", prompt: reportStyleDashboard },
  { id: "research", label: "Research", prompt: reportStyleResearch },
  { id: "magazine", label: "Magazine", prompt: reportStyleMagazine },
];

export function getReportStyles(): ReportStyle[] {
  const config = getConfig();
  const reports = config.canvas?.reports;

  if (reports && reports.length > 0) {
    return reports.map((r) => ({
      id: r.name.toLowerCase().replace(/\s+/g, "-"),
      label: r.name,
      prompt: r.prompt,
    }));
  }

  return DEFAULT_REPORT_STYLES;
}

type InfographicStyle = { id: string; label: string; prompt: string };

const DEFAULT_INFOGRAPHIC_STYLES: InfographicStyle[] = [
  { id: "auto", label: "Auto-select", prompt: infographicStyleAuto },
  { id: "sketch-note", label: "Sketch Note", prompt: infographicStyleSketchNote },
  { id: "kawaii", label: "Kawaii", prompt: infographicStyleKawaii },
  { id: "professional", label: "Professional", prompt: infographicStyleProfessional },
  { id: "scientific", label: "Scientific", prompt: infographicStyleScientific },
  { id: "anime", label: "Anime", prompt: infographicStyleAnime },
  { id: "clay", label: "Clay", prompt: infographicStyleClay },
  { id: "editorial", label: "Editorial", prompt: infographicStyleEditorial },
  { id: "instructional", label: "Instructional", prompt: infographicStyleInstructional },
  { id: "bento", label: "Bento Grid", prompt: infographicStyleBento },
  { id: "bricks", label: "Bricks", prompt: infographicStyleBricks },
];

export function getInfographicStyles(): InfographicStyle[] {
  const config = getConfig();
  const infographics = config.canvas?.infographics;

  if (infographics && infographics.length > 0) {
    return infographics.map((i) => ({
      id: i.name.toLowerCase().replace(/\s+/g, "-"),
      label: i.name,
      prompt: i.prompt,
    }));
  }

  return DEFAULT_INFOGRAPHIC_STYLES;
}

function buildInfographicInstructions(styleId: string): string {
  const infographicStyles = getInfographicStyles();
  const style =
    infographicStyles.find((s) => s.id === styleId) ?? infographicStyles[0] ?? DEFAULT_INFOGRAPHIC_STYLES[0];
  return studioInfographicInstructions.replace("{{STYLE_SECTION}}", style.prompt);
}

function buildAudioInstructions(styleId: string): string {
  const podcastStyles = getPodcastStyles();
  const style = podcastStyles.find((s) => s.id === styleId) ?? podcastStyles[0] ?? DEFAULT_PODCAST_STYLES[0];
  return studioAudioInstructions.replace("{{STYLE_SECTION}}", style.prompt);
}

function buildReportInstructions(styleId: string): string {
  const reportStyles = getReportStyles();
  const style = reportStyles.find((s) => s.id === styleId) ?? reportStyles[0] ?? DEFAULT_REPORT_STYLES[0];
  return studioReportInstructions.replace("{{STYLE_SECTION}}", style.prompt);
}

const OUTPUT_TITLES: Record<OutputType, string> = {
  podcast: "Podcast",
  slides: "Slides",
  infographic: "Infographic",
  report: "Report",
  quiz: "Quiz",
  mindmap: "Mind Map",
};

export function useNotebook(notebookId?: string) {
  const config = getConfig();
  const client = config.client;

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [sources, setSources] = useState<NotebookSource[]>([]);
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

  const addSearchResult = useCallback(
    async (query: string, mode: "web" | "research", content: string) => {
      const nb = await ensureNotebook();

      const source: NotebookSource = {
        id: generateId(),
        type: "web",
        name: query.slice(0, 60),
        content,
        metadata: { query, url: mode },
        addedAt: new Date().toISOString(),
      };

      await store.addSource(nb.id, source);
      setSources((prev) => [...prev, source]);
    },
    [ensureNotebook],
  );

  const addFileSource = useCallback(
    async (file: File) => {
      const content = await convertFileToText(file);

      if (!content?.trim()) {
        throw new Error(`Could not extract text from ${file.name}`);
      }

      const nb = await ensureNotebook();

      const source: NotebookSource = {
        id: generateId(),
        type: "file",
        name: file.name,
        content,
        metadata: {
          fileType: file.type,
          fileSize: file.size,
        },
        addedAt: new Date().toISOString(),
      };

      await store.addSource(nb.id, source);
      setSources((prev) => [...prev, source]);
    },
    [ensureNotebook],
  );

  const addTextSource = useCallback(
    async (name: string, text: string, audioUrl?: string) => {
      const nb = await ensureNotebook();

      const source: NotebookSource = {
        id: generateId(),
        type: "text",
        name: name || "Pasted text",
        content: text,
        ...(audioUrl && { audioUrl }),
        addedAt: new Date().toISOString(),
      };

      await store.addSource(nb.id, source);
      setSources((prev) => [...prev, source]);
    },
    [ensureNotebook],
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

      const source: NotebookSource = {
        id: generateId(),
        type: "web",
        name: url,
        content,
        metadata: { url },
        addedAt: new Date().toISOString(),
      };

      await store.addSource(nb.id, source);
      setSources((prev) => [...prev, source]);
    },
    [ensureNotebook],
  );

  const deleteSource = useCallback(
    async (sourceId: string) => {
      if (!notebook) return;
      await store.removeSource(notebook.id, sourceId);
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
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
        const tools = createSourceTools(sourcesRef.current);

        // Build Message[] for the LLM (strip timestamps)
        const conversation = newMessages.map(({ timestamp, ...msg }) => msg);

        const response = await runWithTools(client, getModel(), chatInstructions, conversation, tools, (content) =>
          setStreamingContent(content),
        );

        setStreamingContent(null);

        const assistantMsg: NotebookMessage = {
          ...response,
          timestamp: new Date().toISOString(),
        };

        const finalMessages = [...newMessages, assistantMsg];
        setMessages(finalMessages);
        await store.saveMessages(notebook.id, finalMessages);
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
    [notebook, messages, client, getModel, isChatting],
  );

  // ── Outputs ────────────────────────────────────────────────────────

  const generateOutput = useCallback(
    (type: OutputType, styleId?: string) => {
      if (!notebook || sources.length === 0) return;

      const output: NotebookOutput = {
        id: generateId(),
        type,
        title: OUTPUT_TITLES[type],
        content: "",
        status: "generating",
        createdAt: new Date().toISOString(),
      };

      // Add immediately as generating
      setOutputs((prev) => [output, ...prev]);

      const completeOutput = async (completed: NotebookOutput) => {
        setOutputs((prev) => prev.map((o) => (o.id === output.id ? completed : o)));
        await store.addOutput(notebook.id, completed);
      };

      const failOutput = (err: unknown) => {
        setOutputs((prev) =>
          prev.map((o) =>
            o.id === output.id
              ? {
                  ...o,
                  status: "error" as const,
                  error: err instanceof Error ? err.message : "Generation failed",
                }
              : o,
          ),
        );
      };

      // Fire and forget
      const tools = createSourceTools(sourcesRef.current);
      const instructions =
        type === "slides"
          ? buildSlideInstructions(styleId ?? "whiteboard")
          : type === "podcast"
            ? buildAudioInstructions(styleId ?? "overview")
            : type === "report"
              ? buildReportInstructions(styleId ?? "executive")
              : type === "infographic"
                ? buildInfographicInstructions(styleId ?? "auto")
                : STUDIO_PROMPTS[type];
      const userMessage = {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `Generate a ${OUTPUT_TITLES[type].toLowerCase()} from the available sources.`,
          },
        ],
      };

      if (type === "podcast") {
        // Audio overview: LLM generates script → TTS generates audio per paragraph → merge
        runWithTools(client, getModel(), instructions, [userMessage], tools)
          .then(async (response) => {
            const script = getTextFromContent(response.content);
            if (!script?.trim()) {
              throw new Error("Could not generate audio script");
            }

            const ttsModel = config.tts?.model || "";
            const voiceMap = config.tts?.voices ?? {};
            const resolveVoice = (role: string) => voiceMap[role] || role;
            const podcastStyles = getPodcastStyles();
            const podcastStyle =
              podcastStyles.find((s) => s.id === styleId) ?? podcastStyles[0] ?? DEFAULT_PODCAST_STYLES[0];
            const voices = podcastStyle.voices;

            // Parse segments: for multi-voice styles, extract [1]/[2] speaker tags
            // For single-voice styles, just split by paragraphs
            const segments: { text: string; voice: string }[] = [];
            if (voices.length > 1) {
              // Split by speaker tags: [1] or [2]
              const tagPattern = /^\[(\d+)\]\s*/;
              for (const para of script
                .split(/\n\n+/)
                .map((p) => p.trim())
                .filter(Boolean)) {
                const match = para.match(tagPattern);
                if (match) {
                  const idx = Math.min(parseInt(match[1], 10) - 1, voices.length - 1);
                  segments.push({ text: para.replace(tagPattern, ""), voice: voices[Math.max(0, idx)] });
                } else {
                  segments.push({ text: para, voice: voices[0] });
                }
              }
            } else {
              for (const para of script
                .split(/\n\n+/)
                .map((p) => p.trim())
                .filter(Boolean)) {
                segments.push({ text: para, voice: voices[0] });
              }
            }

            // Generate audio for each segment with its assigned voice
            const audioBlobs = await Promise.all(
              segments.map(async ({ text, voice }) => {
                try {
                  return await client.generateAudio(ttsModel, text, resolveVoice(voice));
                } catch {
                  return null;
                }
              }),
            );

            // Merge WAV blobs into a single audio blob
            const validBlobs = audioBlobs.filter((b): b is Blob => b !== null);
            if (validBlobs.length === 0) {
              throw new Error("Failed to generate audio");
            }

            const mergedBlob = await mergeWavBlobs(validBlobs);
            const audioUrl = await blobToDataUrl(mergedBlob);

            await completeOutput({
              ...output,
              content: script,
              audioUrl,
              status: "completed",
            });
          })
          .catch(failOutput);
      } else if (type === "infographic") {
        // Infographic: LLM generates image prompt → renderer creates image
        runWithTools(client, getModel(), instructions, [userMessage], tools)
          .then(async (response) => {
            const imagePrompt = getTextFromContent(response.content);
            if (!imagePrompt?.trim()) {
              throw new Error("Could not generate image prompt");
            }

            const rendererModel = config.renderer?.model || "";
            const imageBlob = await client.generateImage(rendererModel, imagePrompt);
            const imageUrl = await blobToDataUrl(imageBlob);

            await completeOutput({
              ...output,
              content: imagePrompt,
              imageUrl,
              status: "completed",
            });
          })
          .catch(failOutput);
      } else if (type === "slides") {
        // Slide deck: LLM generates slide text + image prompts → render each slide sequentially
        // so each slide can use the previous one as a style reference
        runWithTools(client, getModel(), instructions, [userMessage], tools)
          .then(async (response) => {
            const fullContent = getTextFromContent(response.content);
            if (!fullContent?.trim()) {
              throw new Error("Could not generate slide deck");
            }

            // Parse slides: split by ---SLIDE--- separator
            const slideBlocks = fullContent
              .split(/---SLIDE---/i)
              .map((s) => s.trim())
              .filter(Boolean);

            // Extract text content and image prompts per slide
            const slideTexts: string[] = [];
            const imagePrompts: string[] = [];

            for (const block of slideBlocks) {
              const parts = block.split(/---PROMPT---/i);
              slideTexts.push((parts[0] || "").trim());
              if (parts[1]) {
                imagePrompts.push(parts[1].trim());
              }
            }

            const textContent = slideTexts.join("\n\n---\n\n");

            // Generate first slide alone to establish style, then remaining in parallel batches of 4
            const rendererModel = config.renderer?.model || "";
            const slideImages: string[] = new Array(imagePrompts.length).fill("");

            if (imagePrompts.length > 0) {
              try {
                const firstBlob = await client.generateImage(rendererModel, imagePrompts[0]);
                slideImages[0] = await blobToDataUrl(firstBlob);

                const remaining = imagePrompts.slice(1);
                for (let i = 0; i < remaining.length; i += 4) {
                  const batch = remaining.slice(i, i + 4);
                  const results = await Promise.allSettled(
                    batch.map((prompt) =>
                      client.generateImage(rendererModel, prompt, [firstBlob]).then((blob) => blobToDataUrl(blob)),
                    ),
                  );
                  for (let j = 0; j < results.length; j++) {
                    const result = results[j];
                    slideImages[1 + i + j] = result.status === "fulfilled" ? result.value : "";
                  }
                }
              } catch {
                // first slide failed — skip all image generation
              }
            }

            await completeOutput({
              ...output,
              content: textContent,
              slides: slideImages.filter(Boolean),
              status: "completed",
            });
          })
          .catch(failOutput);
      } else if (type === "quiz") {
        // Quiz: LLM reads sources → produces structured JSON
        runWithTools(client, getModel(), instructions, [userMessage], tools)
          .then(async (response) => {
            const raw = getTextFromContent(response.content);
            if (!raw?.trim()) throw new Error("Could not generate quiz");

            const jsonStr = raw
              .replace(/^```json?\s*/i, "")
              .replace(/```\s*$/i, "")
              .trim();
            const parsed = JSON.parse(jsonStr) as { questions: QuizQuestion[] };

            if (!parsed.questions?.length) {
              throw new Error("No questions generated");
            }

            await completeOutput({
              ...output,
              content: raw,
              quiz: parsed.questions,
              status: "completed",
            });
          })
          .catch(failOutput);
      } else if (type === "mindmap") {
        // Mind map: LLM reads sources → produces structured JSON tree
        runWithTools(client, getModel(), instructions, [userMessage], tools)
          .then(async (response) => {
            const raw = getTextFromContent(response.content);
            if (!raw?.trim()) throw new Error("Could not generate mind map");

            const jsonStr = raw
              .replace(/^```json?\s*/i, "")
              .replace(/```\s*$/i, "")
              .trim();
            const parsed = JSON.parse(jsonStr) as MindMapNode;

            if (!parsed.label) {
              throw new Error("Invalid mind map structure");
            }

            await completeOutput({
              ...output,
              content: raw,
              mindMap: parsed,
              status: "completed",
            });
          })
          .catch(failOutput);
      } else {
        // Other types: LLM generates text content
        runWithTools(client, getModel(), instructions, [userMessage], tools)
          .then(async (response) => {
            const content = getTextFromContent(response.content);
            if (!content?.trim()) {
              throw new Error("Could not generate output");
            }

            await completeOutput({
              ...output,
              content,
              status: "completed",
            });
          })
          .catch(failOutput);
      }
    },
    [notebook, sources, client, config, getModel],
  );

  const deleteOutput = useCallback(
    async (outputId: string) => {
      if (!notebook) return;
      await store.removeOutput(notebook.id, outputId);
      setOutputs((prev) => prev.filter((o) => o.id !== outputId));
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

    sendMessage,

    generateOutput,
    deleteOutput,
  };
}
