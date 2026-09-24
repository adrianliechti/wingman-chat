import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { buildSelectionEditMessage } from "@/features/chat/lib/selectionMessage";
import { FileSystemManager } from "@/features/artifacts/lib/fs";
import { useChatContext } from "../hooks/useChatContext";
import { useChats } from "@/features/chat/hooks/useChats";
import { getSavedModel, useModels } from "@/features/chat/hooks/useModels";
import { useChatRun } from "../hooks/useChatRun";
import { createChatCreationGate } from "../lib/chatCreation";
import { setModel as setInterpreterModel } from "@/features/tools/lib/llmCommand";
import type { Message, Model } from "@/shared/types/chat";
import { useApp } from "@/shell/hooks/useApp";
import { type ChatContextType } from "./ChatContext";

import { ChatContextProviders } from "./ChatContextProviders";

// A stored effort override only while the model still offers it, so a config
// change never sends a level the model no longer supports.
function supportedEffort(model: Model, effort: Model["effort"]): Model["effort"] {
  const supported = model.supportedEfforts;
  return effort && supported?.length && !supported.includes(effort) ? undefined : effort;
}

// An agent's effort and verbosity override its model's defaults.
function withAgentSettings(model: Model, agent: Agent): Model {
  const effort = supportedEffort(model, agent.effort);
  return {
    ...model,
    ...(effort ? { effort } : {}),
    ...(agent.verbosity ? { verbosity: agent.verbosity } : {}),
  };
}

interface ChatProviderProps {
  children: React.ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const { models, selectedModel, setSelectedModel } = useModels();
  const {
    chats,
    isLoaded: chatsLoaded,
    createChat: createChatHook,
    updateChat,
    deleteChat: deleteChatHook,
    getChat,
    loadChat,
    searchChats,
  } = useChats();
  const {
    isAvailable: artifactsEnabled,
    setFileSystem: setArtifactsFileSystem,
    setEditRequestHandler,
  } = useArtifacts();
  const { closeApp } = useApp();
  const { currentAgent } = useAgents();
  const [chatId, setChatId] = useState<string | null>(null);
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
  const chat = chatId ? (getChat(chatId) ?? null) : null;
  const chatError = !chat && loadError?.id === chatId ? loadError.error : null;
  const chatLoading = !!chatId && !chat && !chatError;
  const createChatOnce = useMemo(() => createChatCreationGate(), []);
  const currentChatModel = chat?.model;
  const agentModel = useMemo(() => {
    if (!currentAgent?.model) return null;
    // The catalog can be loading or omit a previously selected model. Keep
    // applying agent settings to a matching cached model in either case.
    const found =
      models.find((m) => m.id === currentAgent.model) ??
      [currentChatModel, selectedModel].find((m) => m?.id === currentAgent.model);
    return found ? withAgentSettings(found, currentAgent) : null;
  }, [models, currentAgent, currentChatModel, selectedModel]);
  // Resolve to the fresh config model so tools/instructions/supportedEfforts stay
  // current, but keep the chat's stored `effort` and `verbosity` (the per-chat
  // selection, which starts at the model's configured default and the user can
  // change in the picker or via a slider preset).
  // Memoized so the effort overlay doesn't mint a new `model` object every render
  // (which would thrash useChatContext and other model-keyed memos on each token).
  const chatModel = useMemo(() => {
    if (!currentChatModel) return null;
    const resolved = models.find((m) => m.id === currentChatModel.id) ?? currentChatModel;
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
    runtimeContext: chatRuntimeContext,
    memory: chatMemory,
  } = useChatContext("chat", model, models);

  useEffect(() => {
    setInterpreterModel(model?.id ?? null);
  }, [model?.id]);

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

  useLayoutEffect(() => {
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

  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  const selectChat = useCallback(
    (id: string | null) => {
      if (id === chatIdRef.current) return;

      selectionVersionRef.current++;
      chatIdRef.current = id;
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
        setChatId(null);
      }
    },
    [deleteChatHook, chatId],
  );

  const setModel = useCallback(
    (model: Model | null) => {
      if (chatIdRef.current) {
        updateChat(chatIdRef.current, () => ({ model }));
        // Also remember the last chat model globally so new chats / mode
        // toggles can restore it.
        setSelectedModel(model);
      } else {
        setSelectedModel(model);
      }
    },
    [updateChat, setSelectedModel],
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
      chatItem = await createChatOnce(createChatHook);
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
      // Uploads can finish before React renders the newly created chat.
      // Bind eagerly so selecting their result uses this same workspace.
      if (artifactsEnabled) setArtifactsFileSystem(fsForChat);
    }

    return { id: chatItem.id, chat: chatItem, fs: fsForChat };
  }, [model, createChatHook, createChatOnce, updateChat, loadChat, artifactsEnabled, setArtifactsFileSystem]);

  // Public alias for features (drawer, terminal, attachment sends) that need a
  // filesystem before the user's first message — same creation path as sending.
  const ensureChat = useCallback(async () => {
    const { chat: ensuredChat, fs: ensuredFs } = await getOrCreateChat();
    return { chat: ensuredChat, fs: ensuredFs };
  }, [getOrCreateChat]);

  const addMessage = useCallback(
    async (message: Message, targetChatId?: string) => {
      const id = targetChatId ?? (await getOrCreateChat()).id;
      await loadChat(id);

      // Use the updater pattern to get fresh messages from the chat
      updateChat(id, (currentChat) => ({
        messages: [...(currentChat.messages || []), message],
      }));
    },
    [getOrCreateChat, loadChat, updateChat],
  );

  const run = useChatRun({
    model,
    models,
    chatId,
    chatIdRef,
    fsRef,
    artifactsEnabled,
    getChat,
    updateChat,
    getOrCreateChat,
    chatTools,
    chatInstructions,
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

    // Attach transient streaming content without persisting it on every token
    if (streamingMessage && chat?.id === streamingMessage.chatId) {
      return [...baseMessages, streamingMessage.message];
    }

    return baseMessages;
  }, [chat?.messages, chat?.id, streamingMessage]);

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

    addMessage,
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
