import { useState, useCallback, useEffect, useRef } from 'react';
import { getConfig } from '@/shared/config';
import { convertFileToText } from '@/shared/lib/convert';
import { getTextFromContent } from '@/shared/types/chat';
import type { Content } from '@/shared/types/chat';
import type {
  Notebook,
  NotebookSource,
  NotebookOutput,
  NotebookMessage,
  OutputType,
} from '../types/notebook';
import { blobToDataUrl } from '@/shared/lib/opfs-core';
import { createSourceTools } from '../lib/source-tools';
import { runWithTools } from '../lib/tool-loop';
import * as store from '../lib/opfs-notebook';

import type { QuizQuestion, MindMapNode } from '../types/notebook';
import chatInstructions from '../prompts/chat.txt?raw';
import studioAudioInstructions from '../prompts/studio-audio-overview.txt?raw';
import studioSlideInstructions from '../prompts/studio-slide-deck.txt?raw';
import studioInfographicInstructions from '../prompts/studio-infographic.txt?raw';
import studioDataTableInstructions from '../prompts/studio-data-table.txt?raw';
import studioQuizInstructions from '../prompts/studio-quiz.txt?raw';
import studioMindMapInstructions from '../prompts/studio-mind-map.txt?raw';

function generateId(): string {
  return crypto.randomUUID()
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
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + totalDataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, totalDataSize, true);

  // Copy PCM data
  const output = new Uint8Array(result);
  let offset = headerSize;
  for (const chunk of pcmChunks) {
    output.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return new Blob([result], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

const STUDIO_PROMPTS: Record<OutputType, string> = {
  'audio-overview': studioAudioInstructions,
  'slide-deck': studioSlideInstructions,
  'infographic': studioInfographicInstructions,
  'data-table': studioDataTableInstructions,
  'quiz': studioQuizInstructions,
  'mind-map': studioMindMapInstructions,
};

const OUTPUT_TITLES: Record<OutputType, string> = {
  'audio-overview': 'Audio Overview',
  'slide-deck': 'Slide Deck',
  'infographic': 'Infographic',
  'data-table': 'Data Table',
  'quiz': 'Quiz',
  'mind-map': 'Mind Map',
};

export function useNotebook(notebookId?: string) {
  const config = getConfig();
  const client = config.client;

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [sources, setSources] = useState<NotebookSource[]>([]);
  const [outputs, setOutputs] = useState<NotebookOutput[]>([]);
  const [messages, setMessages] = useState<NotebookMessage[]>([]);

  const [isSearching, setIsSearching] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [streamingContent, setStreamingContent] = useState<Content[] | null>(null);

  // Keep a ref to sources so tool closures always see latest
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const getModel = useCallback(() => {
    return config.notebook?.model || '';
  }, [config.notebook]);

  // ── Init / Load ────────────────────────────────────────────────────

  const initNotebook = useCallback(async (id?: string) => {
    const rid = id || generateId();
    const existing = await store.getNotebook(rid);

    if (existing) {
      setNotebook(existing);
      const [s, o, m] = await Promise.all([
        store.getSources(rid),
        store.getOutputs(rid),
        store.getMessages(rid),
      ]);
      setSources(s);
      setOutputs(o);
      setMessages(m);
    } else {
      const now = new Date().toISOString();
      const r: Notebook = {
        id: rid,
        title: 'Untitled notebook',
        createdAt: now,
        updatedAt: now,
      };
      await store.saveNotebook(r);
      setNotebook(r);
      setSources([]);
      setOutputs([]);
      setMessages([]);
    }

    return rid;
  }, []);

  useEffect(() => {
    if (notebookId) {
      initNotebook(notebookId);
    }
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

  const addWebSource = useCallback(
    async (query: string, mode: 'web' | 'research') => {
      if (!notebook) return;
      setIsSearching(true);

      try {
        let content: string;
        let name: string;

        if (mode === 'research') {
          content = await client.research(
            '',
            query,
          );
          name = query.slice(0, 60);
        } else {
          const results = await client.search(
            config.internet?.searcher || '',
            query,
          );
          content = results
            .map((r) => `## ${r.title || r.source || 'Result'}\n\n${r.content}`)
            .join('\n\n---\n\n');
          name = query.slice(0, 60);
        }

        if (!content?.trim()) {
          throw new Error('No results found');
        }

        const source: NotebookSource = {
          id: generateId(),
          type: 'web',
          name,
          content,
          metadata: { query, url: mode },
          addedAt: new Date().toISOString(),
        };

        const updated = await store.addSource(notebook.id, source);
        setSources(updated);
      } finally {
        setIsSearching(false);
      }
    },
    [notebook, client, config],
  );

  const addFileSource = useCallback(
    async (file: File) => {
      if (!notebook) return;

      const content = await convertFileToText(
        file,
        (f) => client.extractText(f),
      );

      if (!content?.trim()) {
        throw new Error(`Could not extract text from ${file.name}`);
      }

      const source: NotebookSource = {
        id: generateId(),
        type: 'file',
        name: file.name,
        content,
        metadata: {
          fileType: file.type,
          fileSize: file.size,
        },
        addedAt: new Date().toISOString(),
      };

      const updated = await store.addSource(notebook.id, source);
      setSources(updated);
    },
    [notebook, client],
  );

  const deleteSource = useCallback(
    async (sourceId: string) => {
      if (!notebook) return;
      const updated = await store.removeSource(notebook.id, sourceId);
      setSources(updated);
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
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: new Date().toISOString(),
      };

      const newMessages = [...messages, userMsg];
      setMessages(newMessages);

      try {
        const tools = createSourceTools(sourcesRef.current);

        // Build Message[] for the LLM (strip timestamps)
        const conversation = newMessages.map(({ timestamp, ...msg }) => msg);

        const response = await runWithTools(
          client,
          getModel(),
          chatInstructions,
          conversation,
          tools,
          (content) => setStreamingContent(content),
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
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: `Error: ${err instanceof Error ? err.message : 'Failed to generate response'}`,
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
    (type: OutputType) => {
      if (!notebook || sources.length === 0) return;

      const output: NotebookOutput = {
        id: generateId(),
        type,
        title: OUTPUT_TITLES[type],
        content: '',
        status: 'generating',
        createdAt: new Date().toISOString(),
      };

      // Add immediately as generating
      setOutputs((prev) => [output, ...prev]);

      const completeOutput = async (completed: NotebookOutput) => {
        setOutputs((prev) =>
          prev.map((o) => (o.id === output.id ? completed : o)),
        );
        const current = await store.getOutputs(notebook.id);
        await store.saveOutputs(notebook.id, [completed, ...current]);
      };

      const failOutput = (err: unknown) => {
        setOutputs((prev) =>
          prev.map((o) =>
            o.id === output.id
              ? {
                  ...o,
                  status: 'error' as const,
                  error:
                    err instanceof Error ? err.message : 'Generation failed',
                }
              : o,
          ),
        );
      };

      // Fire and forget
      const tools = createSourceTools(sourcesRef.current);
      const instructions = STUDIO_PROMPTS[type];
      const userMessage = {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: `Generate a ${OUTPUT_TITLES[type].toLowerCase()} from the available sources.`,
          },
        ],
      };

      if (type === 'audio-overview') {
        // Audio overview: LLM generates script → TTS generates audio per paragraph → merge
        runWithTools(client, getModel(), instructions, [userMessage], tools)
          .then(async (response) => {
            const script = getTextFromContent(response.content);
            if (!script?.trim()) {
              throw new Error('Could not generate audio script');
            }

            const ttsModel = config.tts?.model || '';
            // Split into paragraphs for TTS
            const paragraphs = script
              .split(/\n\n+/)
              .map((p) => p.trim())
              .filter((p) => p.length > 0);

            // Generate audio for each paragraph
            const audioBlobs = await Promise.all(
              paragraphs.map(async (text) => {
                try {
                  return await client.generateAudio(ttsModel, text);
                } catch {
                  return null;
                }
              }),
            );

            // Merge WAV blobs into a single audio blob
            const validBlobs = audioBlobs.filter((b): b is Blob => b !== null);
            if (validBlobs.length === 0) {
              throw new Error('Failed to generate audio');
            }

            const mergedBlob = await mergeWavBlobs(validBlobs);
            const audioUrl = await blobToDataUrl(mergedBlob);

            await completeOutput({
              ...output,
              content: script,
              audioUrl,
              status: 'completed',
            });
          })
          .catch(failOutput);
      } else if (type === 'infographic') {
        // Infographic: LLM generates image prompt → renderer creates image
        runWithTools(client, getModel(), instructions, [userMessage], tools)
          .then(async (response) => {
            const imagePrompt = getTextFromContent(response.content);
            if (!imagePrompt?.trim()) {
              throw new Error('Could not generate image prompt');
            }

            const rendererModel = config.renderer?.model || '';
            const imageBlob = await client.generateImage(rendererModel, imagePrompt);
            const imageUrl = await blobToDataUrl(imageBlob);

            await completeOutput({
              ...output,
              content: imagePrompt,
              imageUrl,
              status: 'completed',
            });
          })
          .catch(failOutput);
      } else if (type === 'slide-deck') {
        // Slide deck: LLM generates slide text + image prompts → render each slide sequentially
        // so each slide can use the previous one as a style reference
        runWithTools(client, getModel(), instructions, [userMessage], tools)
          .then(async (response) => {
            const fullContent = getTextFromContent(response.content);
            if (!fullContent?.trim()) {
              throw new Error('Could not generate slide deck');
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
              slideTexts.push((parts[0] || '').trim());
              if (parts[1]) {
                imagePrompts.push(parts[1].trim());
              }
            }

            const textContent = slideTexts.join('\n\n---\n\n');

            // Generate slide images sequentially, passing the previous slide
            // as a visual reference so the renderer maintains a consistent style
            const rendererModel = config.renderer?.model || '';
            const slideImages: string[] = [];
            let prevBlob: Blob | null = null;

            for (const prompt of imagePrompts) {
              try {
                const refImages = prevBlob ? [prevBlob] : undefined;
                const blob = await client.generateImage(rendererModel, prompt, refImages);
                prevBlob = blob;
                slideImages.push(await blobToDataUrl(blob));
              } catch {
                slideImages.push(''); // skip failed slides
              }
            }

            await completeOutput({
              ...output,
              content: textContent,
              slides: slideImages.filter(Boolean),
              status: 'completed',
            });
          })
          .catch(failOutput);
      } else if (type === 'quiz') {
        // Quiz: LLM reads sources → produces structured JSON
        runWithTools(client, getModel(), instructions, [userMessage], tools)
          .then(async (response) => {
            const raw = getTextFromContent(response.content);
            if (!raw?.trim()) throw new Error('Could not generate quiz');

            const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
            const parsed = JSON.parse(jsonStr) as { questions: QuizQuestion[] };

            if (!parsed.questions?.length) {
              throw new Error('No questions generated');
            }

            await completeOutput({
              ...output,
              content: raw,
              quiz: parsed.questions,
              status: 'completed',
            });
          })
          .catch(failOutput);
      } else if (type === 'mind-map') {
        // Mind map: LLM reads sources → produces structured JSON tree
        runWithTools(client, getModel(), instructions, [userMessage], tools)
          .then(async (response) => {
            const raw = getTextFromContent(response.content);
            if (!raw?.trim()) throw new Error('Could not generate mind map');

            const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
            const parsed = JSON.parse(jsonStr) as MindMapNode;

            if (!parsed.label) {
              throw new Error('Invalid mind map structure');
            }

            await completeOutput({
              ...output,
              content: raw,
              mindMap: parsed,
              status: 'completed',
            });
          })
          .catch(failOutput);
      } else {
        // Other types: LLM generates text content
        runWithTools(client, getModel(), instructions, [userMessage], tools)
          .then(async (response) => {
            const content = getTextFromContent(response.content);
            if (!content?.trim()) {
              throw new Error('Could not generate output');
            }

            await completeOutput({
              ...output,
              content,
              status: 'completed',
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
      const updated = await store.removeOutput(notebook.id, outputId);
      setOutputs(updated);
    },
    [notebook],
  );

  return {
    notebook,
    sources,
    outputs,
    messages,
    streamingContent,

    isSearching,
    isChatting,

    initNotebook,
    updateTitle,

    addWebSource,
    addFileSource,
    deleteSource,

    sendMessage,

    generateOutput,
    deleteOutput,
  };
}
