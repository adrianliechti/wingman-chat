import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import type { ProcessedFile } from "@/features/artifacts/lib/artifacts";
import { applyArtifactStopPolicy } from "@/features/artifacts/lib/artifact-stop-policy";
import { FileSystemManager } from "@/features/artifacts/lib/fs";
import { useChatContext } from "@/features/chat/hooks/useChatContext";
import { parseArtifactReference } from "@/features/chat/components/chatMessageUtils";
import { useChats } from "@/features/chat/hooks/useChats";
import { useModels } from "@/features/chat/hooks/useModels";
import { mergeQueuedMessages, queuedSend, type QueuedSend } from "@/features/chat/lib/chatQueue";
import { setModel as setInterpreterModel } from "@/features/tools/lib/llmCommand";
import { type CategoryConfig, categorySlug, getConfig, type RiskConfig, riskSlug } from "@/shared/config";
import { run as agentRun, type AgentRunEvent } from "@/shared/lib/agent";
import type { Client } from "@/shared/lib/client";
import { getErrorInfo, isAbortError } from "@/shared/lib/errors";
import { compactThreshold, minimalEffort } from "@/shared/lib/models";
import { notify } from "@/shared/lib/notify";
import { trimBulkyToolHistory } from "@/shared/lib/toolHistoryTrim";
import { serializeToolResultForApi } from "@/shared/lib/utils";
import type { Content, Message, Model, TextContent, ToolCallContent, ToolContext } from "@/shared/types/chat";
import { Role, withMessageIdentity } from "@/shared/types/chat";
import type {
  ConsentResult,
  Elicitation,
  ElicitationResult,
  PendingConsent,
  PendingElicitation,
} from "@/shared/types/elicitation";
import { useApp } from "@/shell/hooks/useApp";
import type { ChatContextType } from "./ChatContext";
import { ChatContext } from "./ChatContext";

/** Messages from the last summary marker onward — the window actually sent to the model. */
function messagesSinceSummary(messages: Message[]): Message[] {
  const idx = messages.findLastIndex((m) => m.content.some((p) => p.type === "summary"));
  return idx > 0 ? messages.slice(idx) : messages;
}

function isUserMessage(message: Message): boolean {
  return (
    message.role === Role.User &&
    message.content.some((part) => part.type !== "tool_result" && part.type !== "runtime_feedback")
  );
}

/**
 * Skill instructions are durable behavioral guidance, so they must survive
 * pruning at the summary marker (agentskills.io "manage skill context over
 * time"). We carry the instructions across as plain assistant text rather than
 * replaying the original tool_call/tool_result pair: a skill read batched with
 * another tool call in the same turn would otherwise have its sibling result
 * pruned, leaving an orphaned function_call the Responses API rejects.
 */
function preservedSkillMessages(messages: Message[]): Message[] {
  const skills = new Map<string, string>();

  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== "tool_result" || part.name !== "read_skill") continue;
      const raw = part.result.find((item): item is TextContent => item.type === "text")?.text;
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw) as { name?: unknown; instructions?: unknown };
        if (typeof parsed.name !== "string" || typeof parsed.instructions !== "string") continue;
        // Refresh insertion order when a skill was read more than once so the
        // most recently loaded instructions win without duplicating them.
        skills.delete(parsed.name);
        skills.set(parsed.name, parsed.instructions);
      } catch {
        // Failed skill reads and legacy non-JSON results are not durable guidance.
      }
    }
  }

  return [...skills].map(([name, instructions]) => ({
    role: Role.Assistant,
    content: [{ type: "text", text: `[Active skill: ${name}]\n${instructions}` }],
  }));
}

/** Drop messages before the last summary marker so API requests stay small,
 *  carrying skill instructions across as text so they survive compaction. */
function pruneAtSummary(messages: Message[]): Message[] {
  const idx = messages.findLastIndex((m) => m.content.some((p) => p.type === "summary"));
  if (idx <= 0) return messages;

  const preserved = preservedSkillMessages(messages.slice(0, idx));
  const pruned = [...preserved, ...messages.slice(idx)];
  if (pruned.length < messages.length) {
    console.log(`[Summary] Pruning ${messages.length - pruned.length} messages before summary marker`);
  }
  return pruned;
}

// Wire-only: append a current time/locale `<context>` to the user's real message —
// the last human turn, not a tool result. `now` is captured once per run so the loop
// keeps a stable, cacheable prefix.
function injectContext(messages: Message[], now: Date): Message[] {
  const idx = messages.findLastIndex(isUserMessage);
  if (idx < 0) return messages;

  const platform = window.innerWidth < 768 ? "mobile" : "desktop";
  const pointer = window.matchMedia("(pointer: coarse)").matches ? "touch" : "mouse";
  const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";

  const block = [
    "<context>",
    `Current date and time: ${now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" })}`,
    `ISO 8601 (UTC): ${now.toISOString()}`,
    `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `Client: ${platform}, ${pointer}, ${theme} theme`,
    "</context>",
  ].join("\n");

  return messages.map((m, i) => (i === idx ? { ...m, content: [...m.content, { type: "text", text: block }] } : m));
}

/** Replace inline images before the latest user message with a placeholder.
 *  They're persisted as artifacts (see useFileAttachments) so the model can
 *  re-read them; dropping the base64 from earlier turns keeps requests small.
 *  Model-bound copy only — stored/displayed messages keep their images. */
function stripHistoryImages(messages: Message[]): Message[] {
  const lastUserIndex = messages.findLastIndex((m) => m.role === Role.User);
  if (lastUserIndex <= 0) return messages; // nothing earlier to strip

  let changed = false;
  const result = messages.map((message, index) => {
    if (index >= lastUserIndex || !message.content.some((p) => p.type === "image")) return message;
    changed = true;
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "image"
          ? ({
              type: "text",
              text: `[image "${part.name ?? "image"}" omitted to save context — read it from the artifacts workspace if you need it]`,
            } satisfies TextContent)
          : part,
      ),
    };
  });
  return changed ? result : messages;
}

/**
 * Rough token estimate (chars / 4) approximating the replay payload. Skips
 * reasoning (not replayed to the API) and binary content (images/files).
 */
function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    for (const part of msg.content) {
      if (part.type === "text" || part.type === "summary") {
        chars += part.text.length;
      } else if (part.type === "runtime_feedback") {
        chars += part.text.length;
      } else if (part.type === "artifact_ref") {
        chars += part.path.length + (part.displayName?.length ?? 0) + (part.revision?.length ?? 0) + 24;
      } else if (part.type === "tool_call") {
        chars += part.name.length + part.arguments.length;
      } else if (part.type === "tool_result") {
        for (const r of part.result) {
          if (r.type === "text") chars += r.text.length;
        }
      }
    }
  }
  return Math.ceil(chars / 4);
}

function mediaPlaceholder(part: { type: string; name?: string }): TextContent {
  return {
    type: "text",
    text: `[${part.type}${part.name ? `: ${part.name}` : ""}]`,
  };
}

/**
 * Wire-style view of messages for the summarizer: reasoning is dropped (never
 * replayed to the API either) and binary payloads become short placeholders —
 * JSON.stringifying megabytes of base64 into the helper-model prompt would
 * dwarf the history it's supposed to condense.
 */
function sanitizeForSummary(messages: Message[]): Message[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.flatMap((part): Content[] => {
      switch (part.type) {
        case "reasoning":
          return [];
        case "image":
        case "audio":
        case "file":
          return [mediaPlaceholder(part)];
        case "tool_result":
          // arguments duplicate the paired tool_call and are only used by the
          // UI. Results use the same compact representation as the API wire.
          const output = serializeToolResultForApi(part.result);
          return [
            {
              type: "tool_result",
              id: part.id,
              name: part.name,
              arguments: "",
              result: output ? [{ type: "text", text: output }] : [],
            },
          ];
        default:
          return [part];
      }
    }),
  }));
}

/** Recent human/assistant prose for title, category, and risk classification. */
function sanitizeForClassification(messages: Message[]): Message[] {
  const recent: Message[] = [];

  for (let i = messages.length - 1; i >= 0 && recent.length < 6; i--) {
    const message = messages[i];
    const content = message.content.flatMap((part): Content[] => {
      if (part.type === "text" || part.type === "summary") return [part];
      if (part.type === "image" || part.type === "audio" || part.type === "file") {
        return [mediaPlaceholder(part)];
      }
      return [];
    });
    if (content.length > 0) recent.unshift({ role: message.role, content });
  }

  return recent;
}

function estimateWindowTokens(window: Message[]): number {
  const trimmed = trimBulkyToolHistory(window);
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const message = trimmed[i];
    const usage = message.usage;
    if (message.role === Role.Assistant && usage?.inputTokens) {
      const anchor = usage.inputTokens + (usage.outputTokens ?? 0) - (usage.reasoningTokens ?? 0);
      return anchor + estimateTokens(trimmed.slice(i + 1));
    }
  }
  return estimateTokens(trimmed);
}

/**
 * Insert a summary marker before the current turn when the active context —
 * everything since the last summary marker, gauged as the wire sees it (after
 * bulky-tool trimming) — exceeds `threshold` estimated tokens. Original
 * user/assistant messages stay in storage (the UI still shows them); only the
 * API request gets pruned at the marker by `pruneAtSummary`. The summarizer
 * reads just the active window: the previous marker is that window's first
 * message, so summaries chain instead of re-reading the whole stored history
 * on every compaction. Any prior marker is dropped from storage so they don't
 * stack.
 */
async function compactIfNeeded(
  conversation: Message[],
  threshold: number,
  client: Client,
  summarizerModel: string,
  fallbackModel: string,
  signal?: AbortSignal,
): Promise<Message[]> {
  if (signal?.aborted) return conversation;
  if (!threshold || conversation.length < 2) return conversation;
  // Gauge only the active window (since the last summary) — measuring full
  // storage (kept intact for the UI) would never drop back under the threshold,
  // so we'd re-summarize on every turn.
  const window = messagesSinceSummary(conversation);
  if (estimateWindowTokens(window) < threshold) return conversation;

  // Last message is the user's just-sent turn — don't summarize it. Trim with
  // recentTurns: 1 so only the current turn keeps full payloads: the summarizer
  // doesn't need multi-KB tool dumps to condense what happened.
  const currentTurn = conversation[conversation.length - 1];
  const toSummarize = trimBulkyToolHistory(window, { recentTurns: 1 }).slice(0, -1);
  if (toSummarize.length === 0) return conversation;

  console.log(
    `[Summary] Compacting ${toSummarize.length} messages (~${estimateTokens(toSummarize)} est. tokens, threshold ${threshold})`,
  );

  const payload = sanitizeForSummary(toSummarize);
  let summary: string;
  try {
    summary = await client.summarizeHistory(summarizerModel, payload, { signal });
  } catch (error) {
    if (signal?.aborted) return conversation;
    // A configured summarizer can be a small-window model that chokes on a
    // large window. The chat model just handled this same content, so retry
    // there rather than leaving the conversation permanently uncompactable.
    if (summarizerModel === fallbackModel) throw error;
    console.warn(`[Summary] summarizer ${summarizerModel} failed, retrying with ${fallbackModel}`, error);
    summary = await client.summarizeHistory(fallbackModel, payload, { signal });
  }
  if (!summary) return conversation;

  const summaryMsg: Message = {
    role: Role.Assistant,
    content: [{ type: "summary", text: summary }],
  };
  // Keep all original messages in storage; strip prior summary markers so
  // multiple don't accumulate. pruneAtSummary slices at the latest one.
  const preserved = conversation.slice(0, -1).filter((m) => !m.content.some((p) => p.type === "summary"));
  return [...preserved, summaryMsg, currentTurn];
}

interface ChatProviderProps {
  children: React.ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const config = getConfig();
  const client = config.client;

  const { models, selectedModel, setSelectedModel, getSavedModelId } = useModels();
  const {
    chats,
    isLoaded: chatsLoaded,
    createChat: createChatHook,
    updateChat,
    deleteChat: deleteChatHook,
  } = useChats();
  const { isAvailable: artifactsEnabled, setFileSystem: setArtifactsFileSystem } = useArtifacts();
  const { closeApp } = useApp();
  const { currentAgent } = useAgents();
  const [chatId, setChatId] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const [runPhase, setRunPhase] = useState<ChatContextType["status"]>("idle");
  const [queuedSends, setQueuedSends] = useState<QueuedSend[]>([]);
  const queuedSendsRef = useRef<QueuedSend[]>([]);
  const replaceQueue = useCallback((update: (items: QueuedSend[]) => QueuedSend[]) => {
    const next = update(queuedSendsRef.current);
    queuedSendsRef.current = next;
    setQueuedSends(next);
    return next;
  }, []);
  const [pendingElicitation, setPendingElicitation] = useState<PendingElicitation | null>(null);
  const [toolMeta, setToolMeta] = useState<Record<string, Record<string, unknown>>>({});
  const updateToolMeta = useCallback((toolCallId: string, meta: Record<string, unknown>) => {
    setToolMeta((prev) => {
      const existing = prev[toolCallId];
      const merged = existing ? { ...existing, ...meta } : { ...meta };
      return { ...prev, [toolCallId]: merged };
    });
  }, []);
  const elicitationCompleteCallbacksRef = useRef<Map<string, () => void>>(new Map());
  const [pendingConsent, setPendingConsent] = useState<PendingConsent | null>(null);
  // chatId -> set of category ids the user has accepted in this session. Intentionally not persisted.
  const consentedCategoriesRef = useRef<Map<string, Set<string>>>(new Map());
  // chatId -> set of risk ids already acknowledged in this session (avoid repeating the same warning on every turn).
  const acknowledgedRisksRef = useRef<Map<string, Set<string>>>(new Map());
  const [streamingMessage, setStreamingMessage] = useState<{ chatId: string; message: Message } | null>(null);
  const streamingMessageRef = useRef<{ chatId: string; message: Message } | null>(null);
  const streamFlushTimerRef = useRef<number | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Chat that owns the single in-flight turn, so navigating away can cancel it.
  const runningChatIdRef = useRef<string | null>(null);
  const pendingModelContextRef = useRef<Map<string, string | null>>(new Map());

  const holdQueuedSends = useCallback(
    (targetChatId: string) => {
      replaceQueue((items) =>
        items.map((item) =>
          item.chatId === targetChatId && item.status === "queued" ? { ...item, status: "held" } : item,
        ),
      );
    },
    [replaceQueue],
  );

  const takeQueuedSends = useCallback(
    (targetChatId: string): QueuedSend[] => {
      const ready = queuedSendsRef.current.filter((item) => item.chatId === targetChatId && item.status === "queued");
      if (ready.length > 0) {
        replaceQueue((items) => items.filter((item) => !ready.some((queued) => queued.id === item.id)));
      }
      return ready;
    },
    [replaceQueue],
  );

  // The ref always holds the latest content (so stopStreaming can commit the
  // full partial message synchronously), but the state — and with it the whole
  // message tree — re-renders at most ~8x/s instead of once per streamed token.
  // Clearing (null) applies immediately and cancels any pending flush so stale
  // streaming content can't reappear after the turn was committed.
  const updateStreamingMessage = useCallback((msg: { chatId: string; message: Message } | null) => {
    streamingMessageRef.current = msg;
    if (msg === null) {
      window.clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = undefined;
      setStreamingMessage(null);
      return;
    }
    if (streamFlushTimerRef.current !== undefined) return;
    streamFlushTimerRef.current = window.setTimeout(() => {
      streamFlushTimerRef.current = undefined;
      setStreamingMessage(streamingMessageRef.current);
    }, 120);
  }, []);

  const chat = chats.find((c) => c.id === chatId) ?? null;
  const agentModel = currentAgent?.model ? (models.find((m) => m.id === currentAgent.model) ?? null) : null;
  const currentChatModel = chat?.model;
  // Resolve to the fresh config model so tools/instructions/supportedEfforts stay
  // current, but keep the chat's stored `effort` (the per-chat selection, which
  // starts at the model's configured default and the user can change in the picker).
  // Memoized so the effort overlay doesn't mint a new `model` object every render
  // (which would thrash useChatContext and other model-keyed memos on each token).
  const chatModel = useMemo(() => {
    if (!currentChatModel) return null;
    const resolved = models.find((m) => m.id === currentChatModel.id) ?? currentChatModel;
    return "effort" in currentChatModel ? { ...resolved, effort: currentChatModel.effort } : resolved;
  }, [models, currentChatModel]);
  const model = chatModel ?? agentModel ?? selectedModel ?? models[0];
  const { tools: chatTools, instructions: chatInstructions } = useChatContext("chat", model);

  useEffect(() => {
    setInterpreterModel(model?.id ?? null);
  }, [model?.id]);

  const messages = useMemo(() => {
    const baseMessages = chat?.messages ?? [];

    // Attach transient streaming content without persisting it on every token
    if (streamingMessage && chat?.id === streamingMessage.chatId) {
      return [...baseMessages, streamingMessage.message];
    }

    return baseMessages;
  }, [chat?.messages, chat?.id, streamingMessage]);

  // Own the FileSystemManager lifecycle: one instance per active chat, pushed
  // into the artifacts context. The artifacts feature has no chat knowledge;
  // it just receives the filesystem and reacts to its identity changes.
  // The ref lets ensureChat eagerly create an instance that the next render's
  // useMemo will pick up, so both paths share the same object.
  const fsRef = useRef<FileSystemManager | null>(null);
  const fs = useMemo(() => {
    if (!artifactsEnabled || !chat?.id) {
      fsRef.current = null;
      return null;
    }
    if (fsRef.current?.chatId === chat.id) {
      return fsRef.current;
    }
    const next = new FileSystemManager(chat.id);
    fsRef.current = next;
    return next;
  }, [artifactsEnabled, chat?.id]);

  useEffect(() => {
    setArtifactsFileSystem(fs);
  }, [fs, setArtifactsFileSystem]);

  const createChat = useCallback(async () => {
    const newChat = await createChatHook();
    setChatId(newChat.id);
    return newChat;
  }, [createChatHook]);

  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  const selectChat = useCallback(
    (id: string | null) => {
      if (id === chatIdRef.current) return;

      setChatId(id);
      // Clear any stale post-turn notice so prompts from one thread don't leak into another.
      setPendingConsent(null);
      void closeApp();

      // When starting a new chat, reset realtime model back to the last saved chat model
      if (!id && (selectedModel?.id === "realtime" || chatModel?.id === "realtime")) {
        const savedId = getSavedModelId();
        const restored = (savedId && models.find((m) => m.id === savedId)) || models[0];
        setSelectedModel(restored ?? null);
      }
    },
    [closeApp, selectedModel, chatModel, models, setSelectedModel, getSavedModelId],
  );

  const deleteChat = useCallback(
    (id: string) => {
      deleteChatHook(id);
      if (chatId === id) {
        setChatId(null);
      }
    },
    [deleteChatHook, chatId],
  );

  const setModel = useCallback(
    (model: Model | null) => {
      if (chat) {
        updateChat(chat.id, () => ({ model }));
        // Also remember the last chat model globally so new chats / mode
        // toggles can restore it.
        setSelectedModel(model);
      } else {
        setSelectedModel(model);
      }
    },
    [chat, updateChat, setSelectedModel],
  );

  // Per-chat reasoning effort selection. Stored as `effort` on the chat's model
  // so it rides the existing `chat.model` persistence; it starts at the model's
  // configured default and overrides it for this chat. null clears it.
  const setEffort = useCallback(
    (effort: Model["effort"] | null) => {
      if (!model) return;
      const next: Model = { ...model, effort: effort ?? undefined };
      setModel(next);
    },
    [model, setModel],
  );

  // Single chat-creation path. Returns the active chat (creating it if needed)
  // together with its `FileSystemManager`. The fs is bound eagerly and cached
  // in `fsRef` so callers get it without waiting for React to re-derive `fs`.
  // Used by message sending, addMessage, and ensureChat alike — there is no
  // separate creation logic. Tool selections are sticky (persisted), so any
  // toggled while composing carry into the first turn.
  const getOrCreateChat = useCallback(async () => {
    if (!model) {
      throw new Error("no model selected");
    }

    const existingId = chatIdRef.current;
    let chatItem = existingId ? chats.find((c) => c.id === existingId) : undefined;
    if (!chatItem) {
      chatItem = await createChatHook();
      chatItem.model = model;
      chatIdRef.current = chatItem.id;
      setChatId(chatItem.id);
      updateChat(chatItem.id, () => ({ model }));
    }

    const fsForChat = fsRef.current?.chatId === chatItem.id ? fsRef.current : new FileSystemManager(chatItem.id);
    fsRef.current = fsForChat;

    return { id: chatItem.id, chat: chatItem, fs: fsForChat };
  }, [model, createChatHook, updateChat, chats]);

  // Public alias for features (drawer, terminal, attachment sends) that need a
  // filesystem before the user's first message — same creation path as sending.
  const ensureChat = useCallback(async () => {
    const { chat: ensuredChat, fs: ensuredFs } = await getOrCreateChat();
    return { chat: ensuredChat, fs: ensuredFs };
  }, [getOrCreateChat]);

  const addMessage = useCallback(
    async (message: Message) => {
      const { id } = await getOrCreateChat();

      // Use the updater pattern to get fresh messages from the chat
      updateChat(id, (currentChat) => ({
        messages: [...(currentChat.messages || []), message],
      }));
    },
    [getOrCreateChat, updateChat],
  );

  const updateModelContext = useCallback(async (targetChatId: string, text: string | null) => {
    if (!text?.trim()) {
      pendingModelContextRef.current.delete(targetChatId);
      return;
    }

    pendingModelContextRef.current.set(targetChatId, text.trim());
  }, []);

  const requestElicitation = useCallback(
    (toolCallId: string, toolName: string, elicitation: Elicitation): Promise<ElicitationResult> => {
      return new Promise((resolve) => {
        setPendingElicitation({
          toolCallId,
          toolName,
          elicitation,
          resolve,
        });
      });
    },
    [],
  );

  const runMessageInChat = useCallback(
    async function run(id: string, message: Message, historyOverride?: Message[], initialTitle?: string) {
      const currentModel = model;
      if (!currentModel) {
        throw new Error("no model selected");
      }

      const history = historyOverride ?? (chats.find((c) => c.id === id)?.messages || []);
      const pendingModelContext = pendingModelContextRef.current.get(id) ?? null;
      pendingModelContextRef.current.delete(id);

      const runId = crypto.randomUUID();
      const outgoingMessage = withMessageIdentity(appendTextContent(message, pendingModelContext), runId);

      let conversation = [...history, outgoingMessage];

      updateChat(id, () => ({ messages: conversation }));
      setIsResponding(true);
      setRunPhase("thinking");

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      runningChatIdRef.current = id;

      // Kick off the combined title + classification call in parallel with the model turn so
      // the consent/risk overlay can appear as soon as the user hits send, without waiting for
      // the stream. When categories or risks are configured we run every turn for detection
      // (and refresh the title every turn for free). With neither configured we keep the
      // original initial + every-3-user-turns cadence.
      const categoryConfigs = config.chat?.categories ?? [];
      const riskConfigs = config.chat?.risks ?? [];
      const classificationCfg = config.chat?.classification;
      const defaultThreshold = classificationCfg?.threshold ?? 0.5;
      const hasCategories = categoryConfigs.length > 0;
      const hasRisks = riskConfigs.length > 0;
      const userTurnCount = conversation.filter(isUserMessage).length;
      const needsTitle = !initialTitle || userTurnCount % 3 === 1;
      if (needsTitle || hasCategories || hasRisks) {
        const classificationModel = classificationCfg?.model || config.chat?.summarizer || currentModel.id;
        const classificationEffort = classificationCfg?.effort ?? minimalEffort(classificationModel);
        client
          .classifyChat(
            classificationModel,
            // Classification concerns user intent, not tool implementation or
            // output. Keep only recent prose and lightweight media placeholders.
            sanitizeForClassification(conversation),
            categoryConfigs.map((c) => ({ id: categorySlug(c.name), description: c.description })),
            riskConfigs.map((r) => ({ id: riskSlug(r.name), description: r.description })),
            { effort: classificationEffort, signal: abortController.signal },
          )
          .then(({ title, categories: detectedCategories, risks: detectedRisks }) => {
            if (abortController.signal.aborted) return;
            if (title) {
              updateChat(id, () => ({ title }));
            }

            // Risks take precedence over category consent — they're more severe.
            let next: PendingConsent | null = null;
            if (detectedRisks.length > 0 && hasRisks) {
              const acknowledged = acknowledgedRisksRef.current.get(id) ?? new Set<string>();
              const matchedRisk = detectedRisks
                .map((match) => {
                  const cfg = riskConfigs.find((r) => riskSlug(r.name) === match.id);
                  return cfg ? { cfg, confidence: match.confidence } : null;
                })
                .filter((m): m is { cfg: RiskConfig; confidence: number } => m !== null)
                .filter(({ cfg, confidence }) => confidence >= (cfg.threshold ?? defaultThreshold))
                .filter(({ cfg }) => !acknowledged.has(riskSlug(cfg.name)))
                // Show the highest-confidence unacknowledged risk first.
                .sort((a, b) => b.confidence - a.confidence)[0];

              if (matchedRisk) {
                const { cfg } = matchedRisk;
                next = {
                  kind: "risk",
                  id: riskSlug(cfg.name),
                  name: cfg.name,
                  consent: {
                    message:
                      cfg.message ??
                      `This request appears to involve "${cfg.name}", which may require special attention. Please review before continuing.`,
                    severity: cfg.severity ?? "medium",
                  },
                  resolve: () => {},
                };
              }
            }

            if (!next && detectedCategories.length > 0 && hasCategories) {
              const consented = consentedCategoriesRef.current.get(id) ?? new Set<string>();
              const toAsk = detectedCategories
                .map((match) => {
                  const cfg = categoryConfigs.find((c) => categorySlug(c.name) === match.id);
                  return cfg ? { cfg, confidence: match.confidence } : null;
                })
                .filter((m): m is { cfg: CategoryConfig; confidence: number } => m !== null)
                .filter(({ cfg, confidence }) => confidence >= (cfg.threshold ?? defaultThreshold))
                .find(({ cfg }) => !!cfg.consent && !consented.has(categorySlug(cfg.name)));

              if (toAsk) {
                const customText = typeof toAsk.cfg.consent === "string" ? toAsk.cfg.consent : null;
                next = {
                  kind: "category",
                  id: categorySlug(toAsk.cfg.name),
                  name: toAsk.cfg.name,
                  consent: {
                    message:
                      customText ?? `This conversation appears to be about "${toAsk.cfg.name}". Please acknowledge.`,
                  },
                  resolve: () => {},
                };
              }
            }

            if (next) {
              setPendingConsent((prev) => prev ?? next);
            }
          })
          .catch((err) => {
            if (!isAbortError(err)) console.error("classifyChat failed", err);
          });
      }

      // Create tool context with current message content and elicitation support
      const createToolContext = (currentToolCall: { id: string; name: string }): ToolContext => {
        return {
          model: currentModel.id,
          signal: abortController.signal,
          content: () =>
            outgoingMessage.content.filter(
              (p: Content) => p.type === "text" || p.type === "image" || p.type === "file",
            ) as Content[],
          sendMessage: async (appMessage: Message) => {
            await run(id, appMessage, conversation, initialTitle);
          },
          setContext: async (text: string | null) => {
            await updateModelContext(id, text);
          },
          elicit: (elicitation: Elicitation): Promise<ElicitationResult> => {
            return requestElicitation(currentToolCall.id, currentToolCall.name, elicitation);
          },
          onElicitationComplete: (elicitationId: string) => {
            const cb = elicitationCompleteCallbacksRef.current.get(elicitationId);
            if (cb) {
              elicitationCompleteCallbacksRef.current.delete(elicitationId);
              cb();
            }
          },
        };
      };

      try {
        // Get tools and instructions when needed
        const tools = await chatTools();
        const instructions = chatInstructions();
        const now = new Date();

        // Proactive compaction: condense older messages into a summary marker
        // before the LLM call when the estimated token count exceeds the
        // threshold. `chat.compaction` in config is the master switch — absent
        // means no compaction at all. When enabled, the budget is the model's
        // `compactThreshold` (0 opts a model out) — else the family heuristic
        // (272k GPT-5-class input cap; see models.ts) — capped by
        // chat.compaction.threshold, a deployment-wide ceiling: models compact
        // earlier, never later. The summary survives provider/model swaps
        // because it's plain text, unlike the prior server-side compaction
        // blob. Compaction is an optimization: if the summarizer fails,
        // proceed uncompacted rather than failing the turn.
        const compaction = config.chat?.compaction;
        let threshold = 0;
        if (compaction) {
          threshold = currentModel.compactThreshold ?? compactThreshold(currentModel.id);
          if (compaction.threshold && threshold > 0) threshold = Math.min(threshold, compaction.threshold);
        }
        if (threshold > 0) {
          const summarizerModel = config.chat?.summarizer || currentModel.id;
          try {
            updateStreamingMessage({
              chatId: id,
              message: withMessageIdentity({ role: Role.Assistant, content: [] }, runId),
            });
            setRunPhase("compacting");
            const compacted = await compactIfNeeded(
              conversation,
              threshold,
              client,
              summarizerModel,
              currentModel.id,
              abortController.signal,
            );
            if (compacted !== conversation) {
              conversation = compacted;
              updateChat(id, () => ({ messages: conversation }));
            }
          } catch (error) {
            if (!isAbortError(error)) console.error("[Summary] compaction failed, continuing uncompacted", error);
          } finally {
            if (!abortController.signal.aborted) setRunPhase("thinking");
          }
        }

        const runResult = await agentRun(client, currentModel.id, instructions, conversation, tools, {
          runId,
          agentName: "chat",
          options: {
            effort: currentModel.effort,
            summary: model?.summary,
            verbosity: model?.verbosity,
            signal: abortController.signal,
          },
          prepareMessages: (msgs) => injectContext(stripHistoryImages(trimBulkyToolHistory(pruneAtSummary(msgs))), now),
          onContextOverflow: (msgs) =>
            (async () => {
              setRunPhase("compacting");
              try {
                return await compactIfNeeded(
                  msgs,
                  1,
                  client,
                  config.chat?.summarizer || currentModel.id,
                  currentModel.id,
                  abortController.signal,
                );
              } finally {
                if (!abortController.signal.aborted) setRunPhase("thinking");
              }
            })(),
          onEvent: (event: AgentRunEvent) => {
            if (event.type === "model.started") setRunPhase("thinking");
            else if (event.type === "model.streaming") setRunPhase("responding");
            else if (event.type === "tool.started" || event.type === "tool.updated") setRunPhase("running_tool");
            else if (event.type === "tool.completed") setRunPhase("thinking");
            else if (event.type === "verification.started") setRunPhase("running_tool");
            else if (event.type === "verification.completed") setRunPhase("thinking");
          },
          onTurnStart: () => {
            updateStreamingMessage({
              chatId: id,
              message: withMessageIdentity({ role: Role.Assistant, content: [] }, runId),
            });
          },
          onStream: (contentParts) => {
            updateStreamingMessage({
              chatId: id,
              message: withMessageIdentity({ role: Role.Assistant, content: contentParts }, runId),
            });
          },
          onTurnEnd: (assistant) => {
            conversation = [...conversation, assistant];
            updateChat(id, () => ({ messages: conversation }));
            updateStreamingMessage(null);
          },
          createToolContext: (toolCall: ToolCallContent) => createToolContext(toolCall),
          onToolResult: (toolResult) => {
            conversation = [...conversation, toolResult];
            setPendingElicitation(null);
            // Drop live meta entries — data now lives on tool_result.meta.
            const completedIds = toolResult.content.filter((p) => p.type === "tool_result").map((p) => p.id);
            if (completedIds.length > 0) {
              setToolMeta((prev) => {
                let changed = false;
                const next = { ...prev };
                for (const cid of completedIds) {
                  if (cid in next) {
                    delete next[cid];
                    changed = true;
                  }
                }
                return changed ? next : prev;
              });
            }
            updateChat(id, () => ({ messages: conversation }));
          },
          beforeFinish: async ({ runId: activeRunId, messages: runMessages, signal }) => {
            const activeFs = fsRef.current;
            const studioEnabled = tools.some((tool) => tool.name === "declare_artifact");
            if (!activeFs || !studioEnabled) return { action: "finish" as const };
            return applyArtifactStopPolicy({
              chatId: id,
              runId: activeRunId,
              messages: runMessages,
              fs: activeFs,
              signal,
            });
          },
          onRuntimeFeedback: (feedback) => {
            conversation = [...conversation, feedback];
            updateChat(id, () => ({ messages: conversation }));
          },
          onToolMeta: (toolCallId, meta) => {
            updateToolMeta(toolCallId, meta);
            // Late update after commit: also patch the persisted tool_result in place.
            updateChat(id, (prev) => ({
              messages: prev.messages.map((msg) => ({
                ...msg,
                content: msg.content.map((part) => {
                  if (part.type === "tool_result" && part.id === toolCallId) {
                    return { ...part, meta: { ...part.meta, ...meta } };
                  }
                  return part;
                }),
              })),
            }));
          },
        });
        conversation = runResult.messages;

        const aborted = runResult.status === "aborted" || abortController.signal.aborted;
        abortControllerRef.current = null;
        runningChatIdRef.current = null;

        // Ensure streaming buffer is cleared after completion
        updateStreamingMessage(null);

        // If the stream was stopped by the user, don't run follow-up work
        // (title summarization etc.) on the partial conversation.
        if (aborted) {
          setRunPhase("idle");
          setIsResponding(false);
          return;
        }

        if (runResult.status === "failed") {
          const error = new Error(runResult.error?.message ?? "Agent run failed");
          Object.assign(error, { code: runResult.error?.code ?? "AGENT_RUN_FAILED" });
          throw error;
        }

        if (runResult.status === "max_turns") {
          const ready = takeQueuedSends(id);
          if (ready.length > 0) {
            await run(id, mergeQueuedMessages(ready), conversation, initialTitle);
            return;
          }
          conversation = [
            ...conversation,
            withMessageIdentity(
              {
                role: Role.Assistant,
                content: [],
                error: {
                  code: "MAX_TURNS",
                  message: "This run reached its turn limit. Continue when you're ready to resume.",
                },
              },
              runId,
            ),
          ];
          updateChat(id, () => ({ messages: conversation }));
        }

        if (runResult.status === "completed") {
          // Stop policies may append verification findings or artifact refs
          // after the model turn was committed by onTurnEnd.
          updateChat(id, () => ({ messages: conversation }));
          const ready = takeQueuedSends(id);
          if (ready.length > 0) {
            await run(id, mergeQueuedMessages(ready), conversation, initialTitle);
            return;
          }
        }

        setRunPhase("idle");
        setIsResponding(false);
      } catch (error) {
        console.error(error);
        setIsResponding(false);
        const aborted = abortController.signal.aborted;
        abortControllerRef.current = null;
        runningChatIdRef.current = null;
        updateStreamingMessage(null);

        // If the stream was aborted by the user, exit cleanly without
        // surfacing an error. `stopStreaming()` has already committed any
        // partial content it had buffered.
        if (aborted) {
          setRunPhase("idle");
          return;
        }

        holdQueuedSends(id);

        const { code, message } = getErrorInfo(error);

        conversation = [
          ...conversation,
          withMessageIdentity(
            {
              role: Role.Assistant,
              content: [],
              error: { code, message },
            },
            runId,
          ),
        ];

        updateChat(id, () => ({ messages: conversation }));
        setRunPhase("idle");
      }
    },
    [
      chats,
      updateChat,
      client,
      model,
      config.chat?.summarizer,
      config.chat?.compaction,
      config.chat?.classification,
      config.chat?.categories,
      config.chat?.risks,
      chatTools,
      chatInstructions,
      requestElicitation,
      updateModelContext,
      updateStreamingMessage,
      updateToolMeta,
      takeQueuedSends,
      holdQueuedSends,
    ],
  );

  const sendMessage = useCallback(
    async (message: Message, historyOverride?: Message[], artifactFiles?: ProcessedFile[]) => {
      const { id, chat: chatObj, fs: chatFs } = await getOrCreateChat();
      if (!chatObj) {
        throw new Error(`Chat ${id} not found`);
      }
      // Deferred chat-input attachments: now that the chat (and its fs) exist,
      // write them into the workspace before the turn so the model can read
      // them via the artifacts tools (artifacts was enabled at attach time).
      let resolvedMessage = message;
      if (artifactFiles?.length) {
        try {
          const ingestion = await chatFs.ingestFiles(artifactFiles);
          const revisions = Object.fromEntries(
            ingestion.mutations.map((mutation) => [mutation.path, mutation.revision]),
          );
          resolvedMessage = promoteArtifactReferences(message, ingestion.pathMap, revisions);
        } catch (error) {
          console.error("Failed to add attachments transactionally:", error);
          notify.error("Attachments failed", "No files were added. Resolve the workspace conflict and try again.");
          throw error;
        }
      }
      const identifiedMessage = withMessageIdentity(resolvedMessage);
      if (runningChatIdRef.current === id) {
        replaceQueue((items) => [...items, queuedSend(id, identifiedMessage)]);
        return;
      }
      await runMessageInChat(id, identifiedMessage, historyOverride, chatObj.title);
    },
    [getOrCreateChat, runMessageInChat, replaceQueue],
  );

  const retryMessage = useCallback(async () => {
    if (!chat) return;
    const msgs = chat.messages;
    if (msgs.length === 0) return;

    // Find the trailing error message (assistant with error, no content)
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg.role !== Role.Assistant || !lastMsg.error) return;

    // Strip the error message and find the last user message to re-send
    const withoutError = msgs.slice(0, -1);
    const lastUserIndex = withoutError.findLastIndex((m) => m.role === Role.User);
    if (lastUserIndex < 0) return;

    const lastUserMessage = withoutError[lastUserIndex];
    const historyBeforeUser = withoutError.slice(0, lastUserIndex);

    // Persist the trimmed history, then re-run
    updateChat(chat.id, () => ({ messages: historyBeforeUser }));
    await runMessageInChat(chat.id, lastUserMessage, historyBeforeUser, chat.title);
  }, [chat, updateChat, runMessageInChat]);

  const continueRun = useCallback(async () => {
    if (!chat || isResponding) return;
    const last = chat.messages.at(-1);
    if (last?.role !== Role.Assistant || last.error?.code !== "MAX_TURNS") return;

    const history = chat.messages.slice(0, -1);
    updateChat(chat.id, () => ({ messages: history }));
    await runMessageInChat(
      chat.id,
      withMessageIdentity({ role: Role.User, content: [{ type: "text", text: "Continue." }] }),
      history,
      chat.title,
    );
  }, [chat, isResponding, runMessageInChat, updateChat]);

  const removeQueuedMessage = useCallback(
    (id: string) => {
      replaceQueue((items) => items.filter((item) => item.id !== id));
    },
    [replaceQueue],
  );

  const sendHeldMessage = useCallback(
    async (queueId: string) => {
      const item = queuedSendsRef.current.find((candidate) => candidate.id === queueId && candidate.status === "held");
      if (!item) return;

      if (runningChatIdRef.current === item.chatId) {
        replaceQueue((items) =>
          items.map((candidate) => (candidate.id === queueId ? { ...candidate, status: "queued" } : candidate)),
        );
        return;
      }

      const targetChat = chats.find((candidate) => candidate.id === item.chatId);
      if (!targetChat) {
        removeQueuedMessage(queueId);
        return;
      }
      removeQueuedMessage(queueId);
      await runMessageInChat(item.chatId, item.message, undefined, targetChat.title);
    },
    [chats, removeQueuedMessage, replaceQueue, runMessageInChat],
  );

  const resolveElicitation = useCallback(
    (result: ElicitationResult) => {
      if (!pendingElicitation) return;

      const elicitation = pendingElicitation.elicitation;

      if (elicitation.mode === "url") {
        if (pendingElicitation.waiting) {
          // User cancelled while waiting — resolve the MCP promise now and clean up
          pendingElicitation.resolve({ action: "cancel" });
          elicitationCompleteCallbacksRef.current.delete(elicitation.elicitationId);
          setPendingElicitation(null);
          return;
        }

        if (result.action === "accept") {
          const resolve = pendingElicitation.resolve;
          setPendingElicitation((prev) => (prev ? { ...prev, waiting: true } : null));

          if (elicitationCompleteCallbacksRef.current.size > 0) {
            elicitationCompleteCallbacksRef.current.clear();
          }
          elicitationCompleteCallbacksRef.current.set(elicitation.elicitationId, () => {
            resolve({ action: "accept" });
            setPendingElicitation((prev) => (prev ? { ...prev, waiting: false, completed: true } : null));
            window.setTimeout(() => {
              setPendingElicitation(null);
            }, 1500);
          });
          return;
        }
      }

      pendingElicitation.resolve(result);
      setPendingElicitation(null);
    },
    [pendingElicitation],
  );

  const resolveConsent = useCallback(
    (result: ConsentResult) => {
      setPendingConsent((prev) => {
        if (!prev) return prev;
        if (result.action === "accept" && chatId) {
          const ref = prev.kind === "risk" ? acknowledgedRisksRef : consentedCategoriesRef;
          const set = ref.current.get(chatId) ?? new Set<string>();
          set.add(prev.id);
          ref.current.set(chatId, set);
        }
        return null;
      });
    },
    [chatId],
  );

  const setVoiceToolCall = useCallback(
    (toolName: string | null, callId?: string) => {
      if (toolName === null) {
        updateStreamingMessage(null);
        setIsResponding(false);
      } else {
        const id = chatIdRef.current;
        if (!id) return;
        setIsResponding(true);
        updateStreamingMessage({
          chatId: id,
          message: {
            role: Role.Assistant,
            content: [{ type: "tool_call", id: callId ?? crypto.randomUUID(), name: toolName, arguments: "{}" }],
          },
        });
      }
    },
    [updateStreamingMessage],
  );

  const stopStreaming = useCallback(() => {
    const controller = abortControllerRef.current;
    if (!controller) return;

    // Detach drafts from automatic drain before aborting. The aborted run may
    // settle synchronously; held items can only be sent by an explicit action.
    const runningChatId = runningChatIdRef.current;
    if (runningChatId) holdQueuedSends(runningChatId);
    controller.abort();
    abortControllerRef.current = null;
    runningChatIdRef.current = null;

    // Commit partial streaming content to chat
    const streaming = streamingMessageRef.current;
    if (streaming && streaming.message.content.length > 0) {
      updateChat(streaming.chatId, (prev) => ({
        messages: [...prev.messages, streaming.message],
      }));
    }

    updateStreamingMessage(null);
    setIsResponding(false);
    setRunPhase("idle");
    setPendingElicitation(null);
    setToolMeta({});
  }, [holdQueuedSends, updateChat, updateStreamingMessage]);

  // Navigating to another/new chat cancels the in-flight turn (single run).
  useEffect(() => {
    const runningId = runningChatIdRef.current;
    if (runningId && runningId !== chatId) stopStreaming();
  }, [chatId, stopStreaming]);

  const status: ChatContextType["status"] = pendingElicitation ? "waiting" : runPhase;
  const visibleQueuedSends = queuedSends.filter((item) => item.chatId === chatId);

  const value: ChatContextType = {
    // Models
    models,
    model,
    setModel,
    effort: model?.effort ?? null,
    setEffort,

    // Chats
    chats,
    chatsLoaded,
    chat,
    messages,

    // Chat actions
    createChat,
    selectChat,
    deleteChat,
    updateChat,
    ensureChat,

    // Message actions
    addMessage,
    sendMessage,
    retryMessage,
    continueRun,
    setVoiceToolCall,

    isResponding,
    status,
    queuedSends: visibleQueuedSends,
    removeQueuedMessage,
    sendHeldMessage,
    stopStreaming,
    // Elicitation
    pendingElicitation,
    resolveElicitation,
    requestElicitation,
    toolMeta,
    updateToolMeta,

    pendingConsent,
    resolveConsent,
  };

  return <ChatContext value={value}>{children}</ChatContext>;
}

function appendTextContent(message: Message, text: string | null): Message {
  if (!text || message.role !== Role.User) {
    return message;
  }

  return {
    ...message,
    content: [...message.content, { type: "text", text }],
  };
}

function promoteArtifactReferences(
  message: Message,
  pathMap: Record<string, string>,
  revisions: Record<string, string | undefined>,
): Message {
  return {
    ...message,
    content: message.content.flatMap((part): Content[] => {
      if (part.type === "artifact_ref") {
        const path = pathMap[part.path] ?? part.path;
        return [{ ...part, path, revision: revisions[path] ?? part.revision }];
      }
      if (part.type !== "text") return [part];
      const paths = parseArtifactReference(part.text);
      if (paths.length === 0) return [part];
      return paths.map((requested) => {
        const path = pathMap[requested] ?? requested;
        return {
          type: "artifact_ref" as const,
          path,
          revision: revisions[path],
          displayName: path.split("/").pop() ?? path,
        };
      });
    }),
  };
}
