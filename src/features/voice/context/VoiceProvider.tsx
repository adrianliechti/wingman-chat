import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useChatActions, useChatList, useChatModel } from "@/features/chat/hooks/useChat";
import { useChatContext } from "@/features/chat/hooks/useChatContext";
import { createAttachmentLoader } from "@/features/chat/lib/chatAttachments";
import { getSavedModel } from "@/features/chat/hooks/useModels";
import type { ToolContextFactory } from "@/features/voice/hooks/useVoiceWebSockets";
import { useVoiceWebSockets, voiceSessionSignature } from "@/features/voice/hooks/useVoiceWebSockets";
import { getConfig } from "@/shared/config";
import { notify } from "@/shared/lib/notify";
import type { ContentPart } from "@tanstack/ai";
import { assistantMessage, toolRoundMessage, userMessage } from "@/shared/lib/messages";
import type { ToolContext } from "@/shared/types/chat";
import type { Elicitation } from "@/shared/types/elicitation";
import { useAudioDevices } from "@/shell/hooks/useAudioDevices";
import type { VoiceContextType } from "./VoiceContext";
import { VoiceContext } from "./VoiceContext";
import { resolveModel } from "@/shared/lib/modelSelection";

interface VoiceProviderProps {
  children: React.ReactNode;
}

export function VoiceProvider({ children }: VoiceProviderProps) {
  const [isListening, setIsListening] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const sessionRef = useRef<{
    chatId: string | null;
    inputDeviceId?: string;
    outputDeviceId?: string;
  } | null>(null);
  const voiceChatIdRef = useRef<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const lastLevelUpdateRef = useRef(0);
  const config = getConfig();
  const isAvailable = !!config.voice;
  const { addMessage, ensureChat, setVoiceToolCall, requestElicitation, updateToolMeta } = useChatActions();
  const { models, model, setModel } = useChatModel();
  const { chatId } = useChatList();
  const { currentAgent } = useAgents();
  const isRealtimeSelected = model?.id === "realtime" || currentAgent?.model === "realtime";

  const {
    tools: chatTools,
    instructions: chatInstructions,
    runtimeContext: chatRuntimeContext,
  } = useChatContext("voice", model, models);
  const {
    inputDeviceId,
    outputDeviceId,
    inputDevices,
    outputDevices,
    micPermission,
    devicesEnumerated,
    requestPermission,
  } = useAudioDevices();
  const { start, stop, sendText, updateSession, pauseAudio } = useVoiceWebSockets(
    onUserTranscriptCallback,
    onAssistantTranscriptCallback,
    onToolCallCallback,
    onToolCallDoneCallback,
    onToolResultCallback,
    onClosedCallback,
    chatRuntimeContext,
    onErrorCallback,
  );

  const setVoiceToolCallRef = useRef(setVoiceToolCall);
  const requestElicitationRef = useRef(requestElicitation);
  const updateToolMetaRef = useRef(updateToolMeta);
  const pauseAudioRef = useRef(pauseAudio);
  const setModelRef = useRef(setModel);
  const modelsRef = useRef(models);
  useLayoutEffect(() => {
    setVoiceToolCallRef.current = setVoiceToolCall;
    requestElicitationRef.current = requestElicitation;
    updateToolMetaRef.current = updateToolMeta;
    pauseAudioRef.current = pauseAudio;
    setModelRef.current = setModel;
    modelsRef.current = models;
  });

  function onUserTranscriptCallback(text: string) {
    if (text.trim() && voiceChatIdRef.current) {
      void addMessage(userMessage(text), voiceChatIdRef.current);
    }
  }

  function onAssistantTranscriptCallback(text: string) {
    if (text.trim() && voiceChatIdRef.current) {
      void addMessage(assistantMessage(text), voiceChatIdRef.current);
    }
  }

  function onToolCallCallback(toolName: string, callId: string) {
    setVoiceToolCallRef.current(toolName, callId);
  }

  function onToolCallDoneCallback() {
    setVoiceToolCallRef.current(null);
  }

  // The hook already released mic/player after an unexpected disconnect — sync UI state.
  // On a fatal error also exit realtime mode to prevent auto-start reconnect loop.
  function onClosedCallback(reason?: { fatal: boolean; message: string }) {
    setIsListening(false);
    setIsConnecting(false);
    sessionRef.current = null;
    voiceChatIdRef.current = null;
    setAudioLevel(0);
    setVoiceToolCallRef.current(null);

    if (reason?.fatal) {
      const restored = getSavedModel(modelsRef.current) ?? modelsRef.current.find((m) => m.id !== "realtime") ?? null;
      setModelRef.current(restored);
      console.error("[voice] session ended:", reason.message);
      notify.error("Voice mode stopped", reason.message);
    }
  }

  // Non-fatal service errors (rejected session updates, truncation failures)
  // keep the session alive but should not pass silently.
  function onErrorCallback(error: Error) {
    notify.error("Voice service error", error.message);
  }

  function onToolResultCallback(toolName: string, callId: string, result: ContentPart[], args: string) {
    const sessionChatId = voiceChatIdRef.current;
    if (!sessionChatId) return;
    void addMessage(toolRoundMessage({ id: callId, name: toolName, arguments: args }, result), sessionChatId);
  }

  const buildToolContextFactory = useCallback(
    (currentModel: string | undefined, chatId: string): ToolContextFactory => {
      const owner = sessionRef.current;
      const requireOwner = () => {
        if (!owner || sessionRef.current !== owner) throw new DOMException("Voice session stopped", "AbortError");
      };
      return (toolCall: { id: string; name: string }): ToolContext => {
        return {
          model: currentModel,
          chatId,
          setMeta: (meta: Record<string, unknown>) => {
            updateToolMetaRef.current(toolCall.id, { ...meta });
          },
          elicit: async (elicitation: Elicitation) => {
            requireOwner();
            setVoiceToolCallRef.current(toolCall.name, toolCall.id);
            // Pause the mic during the elicitation, but let buffered playback finish naturally.
            const resume = await pauseAudioRef.current(false);
            return await Promise.resolve()
              .then(() => {
                requireOwner();
                return requestElicitationRef.current(toolCall.id, toolCall.name, elicitation);
              })
              .finally(resume);
          },
        };
      };
    },
    [],
  );

  const lastSessionSignatureRef = useRef<string>("");

  // The realtime model can't run completions for subagents/tool context, so we
  // resolve the first non-realtime completer model to back those operations.
  const underlyingModelId = useMemo(
    () => models.find((m) => m.id !== "realtime" && (!m.type || m.type === "completer"))?.id,
    [models],
  );

  useEffect(() => {
    if (!isListening) return;
    try {
      const instructions = chatInstructions();
      const tools = chatTools();
      const signature = voiceSessionSignature(instructions, tools, underlyingModelId);
      if (signature === lastSessionSignatureRef.current) return;
      lastSessionSignatureRef.current = signature;
      const sessionChatId = voiceChatIdRef.current;
      if (!sessionChatId) return;
      const factory = buildToolContextFactory(underlyingModelId, sessionChatId);
      updateSession(tools, instructions, factory);
    } catch (error) {
      console.error("updateSession failed:", error);
    }
  }, [isListening, chatTools, chatInstructions, updateSession, buildToolContextFactory, underlyingModelId]);

  const stopVoice = useCallback(async () => {
    sessionRef.current = null;
    voiceChatIdRef.current = null;
    setIsListening(false);
    setIsConnecting(false);
    setAudioLevel(0);
    setVoiceToolCall(null);
    await stop();
  }, [stop, setVoiceToolCall]);

  useEffect(
    () => () => {
      sessionRef.current = null;
      voiceChatIdRef.current = null;
    },
    [],
  );

  const startVoice = useCallback(async () => {
    // Guard against re-entrancy from auto-start, Start-audio button, and mic-switch effect.
    if (sessionRef.current) return;
    const session = { chatId: chatId ?? null, inputDeviceId, outputDeviceId };
    sessionRef.current = session;
    const isCurrent = () => sessionRef.current === session;
    const voiceModel = config.voice?.model;
    // Realtime transcription has its own model contract; file STT models
    // (including non-OpenAI providers) are not interchangeable with it.
    const transcribeModel = config.voice?.transcriber;
    try {
      setIsConnecting(true);
      const { chat: sessionChat } = await ensureChat();
      if (!isCurrent()) return;
      session.chatId = sessionChat.id;
      voiceChatIdRef.current = sessionChat.id;
      const realtimeModel = await resolveModel(voiceModel, "realtime");
      if (!isCurrent()) return;
      const tools = chatTools();
      const instructions = chatInstructions();
      const toolContextFactory = buildToolContextFactory(underlyingModelId, sessionChat.id);

      lastSessionSignatureRef.current = voiceSessionSignature(instructions, tools, underlyingModelId);

      const history = await createAttachmentLoader(sessionChat.id)(sessionChat.messages);
      if (!isCurrent()) return;
      await start(
        realtimeModel,
        transcribeModel,
        instructions,
        history,
        tools,
        inputDeviceId,
        outputDeviceId,
        (level) => {
          if (!isCurrent()) return;
          const now = Date.now();
          if (now - lastLevelUpdateRef.current > 80) {
            lastLevelUpdateRef.current = now;
            setAudioLevel(level);
          }
        },
        toolContextFactory,
        // Flip to "listening" only once recording has actually started.
        () => {
          if (!isCurrent()) return;
          setIsConnecting(false);
          setIsListening(true);
        },
      );
    } catch (error) {
      if (!isCurrent()) return;
      void stopVoice();
      console.error("Failed to start voice mode:", error);
      notify.error(
        "Couldn't start voice mode",
        error instanceof Error ? error.message : "Check your audio devices and permissions, then try again.",
      );
    }
  }, [
    chatId,
    stopVoice,
    ensureChat,
    buildToolContextFactory,
    chatInstructions,
    chatTools,
    underlyingModelId,
    start,
    config.voice?.model,
    config.voice?.transcriber,
    inputDeviceId,
    outputDeviceId,
  ]);

  // Both devices are fixed for a session. Cancel pending setup as well as live
  // capture, and start the newest selection without waiting for old contexts to close.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (!isRealtimeSelected || (session.chatId !== null && chatId !== session.chatId)) {
      void stopVoice();
      return;
    }
    if (session.inputDeviceId !== inputDeviceId || session.outputDeviceId !== outputDeviceId) {
      void stopVoice();
      void startVoice();
    }
  }, [isRealtimeSelected, chatId, inputDeviceId, outputDeviceId, isListening, isConnecting, stopVoice, startVoice]);

  // A persisted grant only exposes device labels after a probe stream this
  // session, so refresh them when the user switches into live audio mode.
  useEffect(() => {
    if (
      isRealtimeSelected &&
      micPermission === "granted" &&
      devicesEnumerated &&
      inputDevices.length === 0 &&
      outputDevices.length === 0
    ) {
      void requestPermission();
    }
  }, [
    isRealtimeSelected,
    micPermission,
    devicesEnumerated,
    inputDevices.length,
    outputDevices.length,
    requestPermission,
  ]);

  const sendVoiceText = useCallback(
    (text: string) => {
      void addMessage(userMessage(text));
      void sendText(text);
    },
    [addMessage, sendText],
  );

  const value: VoiceContextType = {
    isAvailable,
    isListening,
    isConnecting,
    audioLevel,
    startVoice,
    stopVoice,
    sendText: sendVoiceText,
  };

  return <VoiceContext value={value}>{children}</VoiceContext>;
}
