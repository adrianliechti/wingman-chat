import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { buildSelectionEditMessage } from "@/features/chat/lib/selectionMessage";
import { FileSystemManager } from "@/features/artifacts/lib/fs";
import { useChatContext } from "../hooks/useChatContext";
import { useChats } from "@/features/chat/hooks/useChats";
import { getSavedModel, useModels } from "@/features/chat/hooks/useModels";
import { useChatRun } from "../hooks/useChatRun";
import { createChatCreationGate } from "../lib/chatCreation";
import { setModel as setInterpreterModel } from "@/features/tools/lib/llmCommand";
import type { Model } from "@/shared/types/chat";
import { findModel } from "@/shared/lib/models";
import { useApp } from "@/shell/hooks/useApp";
import { type ChatContextType } from "./ChatContext";

import { ChatContextProviders } from "./ChatContextProviders";

// A stored effort override only while the model still offers it, so a config
// change never sends a level the model no longer supports.
function supportedEffort(model: Model, effort: Model["effort"]): Model["effort"] {
  const supported = model.supportedEfforts;
  return effort && supported && !supported.includes(effort) ? undefined : effort;
}

// Keep compatible user settings when applying a model's current defaults.
function withModelSettings(model: Model, settings: Pick<Model, "effort" | "verbosity">): Model {
  const effort = supportedEffort(model, settings.effort);
  return {
    ...model,
    ...(effort ? { effort } : {}),
    ...(settings.verbosity ? { verbosity: settings.verbosity } : {}),
  };
}

interface ChatProviderProps {
  children: React.ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const { models, selectedModel, setSelectedModel } = useModels();
  const [chatId, setChatId] = useState<string | null>(null);
  // A draft already has its native thread identity; saving its first message
  // promotes that same thread instead of replacing a client during a send.
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const {
    chats,
    isLoaded: chatsLoaded,
    createChat: createChatHook,
    updateChat,
    deleteChat: deleteChatHook,
    getChat,
    loadChat,
    searchChats,
    selectedChat: chat,
  } = useChats(chatId);
  const {
    isAvailable: artifactsEnabled,
    setFileSystem: setArtifactsFileSystem,
    setEditRequestHandler,
  } = useArtifacts();
  const { closeApp } = useApp();
  const { currentAgent } = useAgents();
  // Updated together with every setChatId so async work sees the selection immediately.
  const chatIdRef = useRef<string | null>(null);
  const selectionVersionRef = useRef(0);
  const [loadError, setLoadError] = useState<{ id: string; error: string } | null>(null);
  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    setLoadError(null);
    void loadChat(chatId).catch((error) => {
      if (!cancelled)
        setLoadError({ id: chatId, error: error instanceof Error ? error.message : "Couldn't load chat" });
    });
    return () => {
      cancelled = true;
    };
  }, [chatId, loadChat]);
  const chatError = !chat && loadError?.id === chatId ? loadError.error : null;
  const chatLoading = !!chatId && !chat && !chatError;
  const createChatOnce = useMemo(() => createChatCreationGate(), []);
  const currentChatModel = chat?.model;
  const agentModel = useMemo(() => {
    if (!currentAgent?.model) return null;
    // The catalog can be loading or omit a previously selected model. Keep
    // applying agent settings to a matching cached model in either case.
    const found =
      findModel(models, currentAgent.model) ??
      [currentChatModel, selectedModel].find((m) => m?.id === currentAgent.model);
    return found ? withModelSettings(found, currentAgent) : null;
  }, [models, currentAgent, currentChatModel, selectedModel]);
  // Resolve to the fresh config model so tools/instructions/supportedEfforts stay
  // current, but keep the chat's stored `effort` and `verbosity` (the per-chat
  // selection, which starts at the model's configured default and the user can
  // change in the picker or via a slider preset).
  // Memoized so the effort overlay doesn't mint a new `model` object every render
  // (which would thrash useChatContext and other model-keyed memos on each token).
  const chatModel = useMemo(() => {
    if (!currentChatModel) return null;
    const resolved = findModel(models, currentChatModel.id) ?? currentChatModel;
    if (resolved.id !== currentChatModel.id) return withModelSettings(resolved, currentChatModel);
    return {
      ...resolved,
      ...("effort" in currentChatModel ? { effort: supportedEffort(resolved, currentChatModel.effort) } : {}),
      // A slider preset can pick a verbosity for the chat, just like effort.
      ...("verbosity" in currentChatModel ? { verbosity: currentChatModel.verbosity } : {}),
    };
  }, [models, currentChatModel]);
  // A selected agent owns the model, effort and verbosity (the picker is hidden
  // meanwhile), so switching agents or editing one in the drawer also applies
  // to existing chats. Deselecting it falls back to the chat's own model.
  const model = agentModel ?? chatModel ?? selectedModel ?? models[0];
  const {
    tools: chatTools,
    instructions: chatInstructions,
    middleware: chatMiddleware,
    runtimeContext: chatRuntimeContext,
    memory: chatMemory,
  } = useChatContext("chat", model, models);

  useEffect(() => {
    setInterpreterModel(model?.id ?? null);
  }, [model?.id]);

  // Own the FileSystemManager lifecycle: one instance per active chat, pushed
  // into the artifacts context. The artifacts feature has no chat knowledge;
  // it just receives the filesystem and reacts to its identity changes.
  // ensureChat can create the instance eagerly (before the chat renders); it is
  // reused once its chat is shown, so both paths share the same object.
  const [eagerFs, setEagerFs] = useState<FileSystemManager | null>(null);
  const shownChatId = chat?.id;
  const fs = useMemo(() => {
    if (!artifactsEnabled || !shownChatId) return null;
    return eagerFs?.chatId === shownChatId ? eagerFs : new FileSystemManager(shownChatId);
  }, [artifactsEnabled, shownChatId, eagerFs]);
  // Synchronous handle for async callers that can't wait for a re-render.
  const fsRef = useRef<FileSystemManager | null>(null);

  useLayoutEffect(() => {
    fsRef.current = fs;
    setArtifactsFileSystem(fs);
  }, [fs, setArtifactsFileSystem]);

  const createChat = useCallback(async () => {
    const version = ++selectionVersionRef.current;
    const newChat = await createChatHook();
    if (version === selectionVersionRef.current) {
      chatIdRef.current = newChat.id;
      setChatId(newChat.id);
    }
    return newChat;
  }, [createChatHook]);

  const selectChat = useCallback(
    (id: string | null) => {
      if (id === chatIdRef.current) return;

      selectionVersionRef.current++;
      chatIdRef.current = id;
      if (!id) setDraftId(crypto.randomUUID());
      setChatId(id);
      // Clear any stale post-turn notice so prompts from one thread don't leak into another.
      void closeApp();

      // When starting a new chat, reset realtime model back to the last saved chat model
      if (!id && (selectedModel?.id === "realtime" || chatModel?.id === "realtime")) {
        setSelectedModel(getSavedModel(models) ?? models[0] ?? null);
      }
    },
    [closeApp, selectedModel, chatModel, models, setSelectedModel],
  );

  const deleteChat = useCallback(
    (id: string) => {
      deleteChatHook(id);
      if (chatId === id) {
        selectionVersionRef.current++;
        chatIdRef.current = null;
        setDraftId(crypto.randomUUID());
        setChatId(null);
      }
    },
    [deleteChatHook, chatId],
  );

  const setModel = useCallback(
    (selection: Model | null) => {
      const resolved = findModel(models, selection?.id);
      const model =
        selection && resolved && resolved.id !== selection.id ? withModelSettings(resolved, selection) : selection;
      if (chatIdRef.current) {
        updateChat(chatIdRef.current, () => ({ model }));
        // Also remember the last chat model globally so new chats / mode
        // toggles can restore it.
        setSelectedModel(model);
      } else {
        setSelectedModel(model);
      }
    },
    [models, updateChat, setSelectedModel],
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

  // Per-chat verbosity, stored on the chat's model like effort. Clearing it
  // restores the configured level, so "Default" follows the model config.
  const configuredVerbosity = model ? models.find((m) => m.id === model.id)?.verbosity : undefined;
  const setVerbosity = useCallback(
    (verbosity: Model["verbosity"] | null) => {
      if (!model) return;
      setModel({ ...model, verbosity: verbosity ?? configuredVerbosity });
    },
    [model, configuredVerbosity, setModel],
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
    const selectionVersion = selectionVersionRef.current;
    let chatItem = existingId ? await loadChat(existingId) : undefined;
    if (!chatItem) {
      chatItem = await createChatOnce(() => createChatHook(draftId));
      chatItem = { ...chatItem, model };
      // Saving a new chat can outlast navigation. The caller still owns its
      // new workspace, but must not replace the user's newer selection.
      if (selectionVersion === selectionVersionRef.current) {
        chatIdRef.current = chatItem.id;
        setChatId(chatItem.id);
      }
      updateChat(chatItem.id, () => ({ model }));
    }

    const fsForChat = fsRef.current?.chatId === chatItem.id ? fsRef.current : new FileSystemManager(chatItem.id);
    if (chatIdRef.current === chatItem.id) {
      fsRef.current = fsForChat;
      setEagerFs(fsForChat);
      // Uploads can finish before React renders the newly created chat.
      // Bind eagerly so selecting their result uses this same workspace.
      if (artifactsEnabled) setArtifactsFileSystem(fsForChat);
    }

    return { id: chatItem.id, chat: chatItem, fs: fsForChat };
  }, [model, createChatHook, createChatOnce, draftId, updateChat, loadChat, artifactsEnabled, setArtifactsFileSystem]);

  // Public alias for features (drawer, terminal, attachment sends) that need a
  // filesystem before the user's first message — same creation path as sending.
  const ensureChat = useCallback(async () => {
    const { chat: ensuredChat, fs: ensuredFs } = await getOrCreateChat();
    return { chat: ensuredChat, fs: ensuredFs };
  }, [getOrCreateChat]);

  const run = useChatRun({
    threadId: chatId ?? draftId,
    model,
    models,
    chatId,
    chatIdRef,
    fsRef,
    artifactsEnabled,
    getChat,
    loadChat,
    updateChat,
    getOrCreateChat,
    chatTools,
    chatInstructions,
    chatMiddleware,
    chatRuntimeContext,
    chatMemory,
  });
  const { streamingMessage, ...runContext } = run;
  // Lets the artifacts viewer send "edit this passage" requests through the active chat.
  const { sendMessage: sendRunMessage } = run;
  useEffect(() => {
    setEditRequestHandler((request) => {
      void sendRunMessage(buildSelectionEditMessage(request));
    });
    return () => setEditRequestHandler(null);
  }, [sendRunMessage, setEditRequestHandler]);
  const messages = useMemo(() => {
    const baseMessages = chat?.messages ?? [];

    // Realtime tool calls are transient; text chat uses TanStack's transcript.
    if (streamingMessage && chat?.id === streamingMessage.chatId) {
      return [...baseMessages, streamingMessage.message];
    }

    // TanStack can be loading before it has an assistant message, including
    // between tool execution and the next model response. Keep this UI-only.
    const last = baseMessages.at(-1);
    if (run.isResponding && chat?.id === chatId && last?.role === "user") {
      return [...baseMessages, { id: `pending-${last.id}`, role: "assistant" as const, content: [] }];
    }

    return baseMessages;
  }, [chat?.messages, chat?.id, chatId, streamingMessage, run.isResponding]);

  const value: ChatContextType = {
    // Models
    models,
    model,
    setModel,
    effort: model?.effort ?? null,
    setEffort,
    // A level equal to the configured one is the default, not an override.
    verbosity: model?.verbosity && model.verbosity !== configuredVerbosity ? model.verbosity : null,
    setVerbosity,

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

    chatId,
    chatLoading,
    chatError,
    hasMessages: messages.length > 0,
    loadChat,
    searchChats,
    ...runContext,
  };

  return <ChatContextProviders value={value}>{children}</ChatContextProviders>;
}
