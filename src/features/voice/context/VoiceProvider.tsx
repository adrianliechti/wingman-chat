import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useChat } from "@/features/chat/hooks/useChat";
import { useChatContext } from "@/features/chat/hooks/useChatContext";
import { getSavedModelId } from "@/features/chat/hooks/useModels";
import type { ToolContextFactory } from "@/features/voice/hooks/useVoiceWebSockets";
import { useVoiceWebSockets } from "@/features/voice/hooks/useVoiceWebSockets";
import { getConfig } from "@/shared/config";
import { notify } from "@/shared/lib/notify";
import type { AudioContent, FileContent, ImageContent, TextContent, ToolContext } from "@/shared/types/chat";
import { Role } from "@/shared/types/chat";
import type { Elicitation } from "@/shared/types/elicitation";
import { useAudioDevices } from "@/shell/hooks/useAudioDevices";
import type { VoiceContextType } from "./VoiceContext";
import { VoiceContext } from "./VoiceContext";

interface VoiceProviderProps {
  children: React.ReactNode;
}

function hashString(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return hash;
}

function sessionSignature(instructions: string, tools: { name: string }[]): string {
  return `${hashString(instructions)}|${tools.map((t) => t.name).join(",")}`;
}

export function VoiceProvider({ children }: VoiceProviderProps) {
  const [isListening, setIsListening] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  // Synchronous re-entrancy guard for startVoice() (state updates can be batched/stale).
  const sessionBusyRef = useRef(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const lastLevelUpdateRef = useRef(0);
  const config = getConfig();
  const [isAvailable] = useState(() => {
    try {
      return !!config.voice;
    } catch (error) {
      console.warn("Failed to get voice config:", error);
      return false;
    }
  });
  const {
    addMessage,
    messages,
    chat,
    models,
    model: selectedModel,
    setModel,
    setVoiceToolCall,
    requestElicitation,
    updateToolMeta,
  } = useChat();
  const { currentAgent } = useAgents();
  const model = chat?.model ?? selectedModel ?? models[0];
  const isRealtimeSelected = model?.id === "realtime" || currentAgent?.model === "realtime";

  const { tools: chatTools, instructions: chatInstructions } = useChatContext("voice", model);
  const { inputDeviceId, outputDeviceId } = useAudioDevices();

  const { start, stop, sendText, updateSession, pauseAudio, resumeAudio } = useVoiceWebSockets(
    onUserTranscriptCallback,
    onAssistantTranscriptCallback,
    onToolCallCallback,
    onToolCallDoneCallback,
    onToolResultCallback,
    onClosedCallback,
  );

  const setVoiceToolCallRef = useRef(setVoiceToolCall);
  setVoiceToolCallRef.current = setVoiceToolCall;
  const requestElicitationRef = useRef(requestElicitation);
  requestElicitationRef.current = requestElicitation;
  const updateToolMetaRef = useRef(updateToolMeta);
  updateToolMetaRef.current = updateToolMeta;
  const pauseAudioRef = useRef(pauseAudio);
  pauseAudioRef.current = pauseAudio;
  const resumeAudioRef = useRef(resumeAudio);
  resumeAudioRef.current = resumeAudio;
  const setModelRef = useRef(setModel);
  setModelRef.current = setModel;
  const modelsRef = useRef(models);
  modelsRef.current = models;

  function onUserTranscriptCallback(text: string) {
    if (text.trim()) {
      void addMessage({ role: Role.User, content: [{ type: "text", text }] });
    }
  }

  function onAssistantTranscriptCallback(text: string) {
    if (text.trim()) {
      void addMessage({ role: Role.Assistant, content: [{ type: "text", text }] });
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
    sessionBusyRef.current = false;
    setAudioLevel(0);
    setVoiceToolCallRef.current(null);

    if (reason?.fatal) {
      const savedId = getSavedModelId();
      const restored =
        (savedId && modelsRef.current.find((m) => m.id === savedId)) ||
        modelsRef.current.find((m) => m.id !== "realtime") ||
        null;
      setModelRef.current(restored);
      console.error("[voice] session ended:", reason.message);
      alert(`Voice mode stopped: ${reason.message}`);
    }
  }

  function onToolResultCallback(
    toolName: string,
    callId: string,
    result: (TextContent | ImageContent | AudioContent | FileContent)[],
  ) {
    void addMessage({
      role: Role.User,
      content: [
        {
          type: "tool_result",
          id: callId,
          name: toolName,
          arguments: "{}",
          result,
        },
      ],
    });
  }

  const buildToolContextFactory = useCallback(
    (currentModel: string | undefined): ToolContextFactory =>
      (toolCall: { id: string; name: string }): ToolContext => {
        let resultMeta: Record<string, unknown> = {};
        return {
          model: currentModel,
          setMeta: (meta: Record<string, unknown>) => {
            resultMeta = meta;
            updateToolMetaRef.current(toolCall.id, { ...meta });
          },
          updateMeta: (meta: Record<string, unknown>) => {
            resultMeta = { ...resultMeta, ...meta };
            updateToolMetaRef.current(toolCall.id, { ...resultMeta });
          },
          elicit: async (elicitation: Elicitation) => {
            setVoiceToolCallRef.current(toolCall.name, toolCall.id);
            // Pause the mic during the elicitation, but let buffered playback finish naturally.
            await pauseAudioRef.current(false);
            try {
              return await requestElicitationRef.current(toolCall.id, toolCall.name, elicitation);
            } finally {
              await resumeAudioRef.current();
            }
          },
        };
      },
    [],
  );

  const lastSessionSignatureRef = useRef<string>("");

  // Device the live session started with; used to detect mid-session mic switches.
  const activeInputDeviceRef = useRef<string | undefined>(undefined);

  // The realtime model can't run completions for subagents/tool context, so we
  // resolve the first non-realtime completer model to back those operations.
  const underlyingModelId = useMemo(
    () => models.find((m) => m.id !== "realtime" && (!m.type || m.type === "completer"))?.id,
    [models],
  );

  useEffect(() => {
    if (!isListening) return;
    const instructions = chatInstructions();
    chatTools()
      .then((tools) => {
        const signature = sessionSignature(instructions, tools);
        if (signature === lastSessionSignatureRef.current) return;
        lastSessionSignatureRef.current = signature;
        const factory = buildToolContextFactory(underlyingModelId);
        updateSession(tools, instructions, factory);
      })
      .catch((err) => console.error("updateSession failed:", err));
  }, [isListening, chatTools, chatInstructions, updateSession, buildToolContextFactory, underlyingModelId]);

  const stopVoice = useCallback(async () => {
    await stop();
    setIsListening(false);
    setIsConnecting(false);
    sessionBusyRef.current = false;
    setAudioLevel(0);
    setVoiceToolCall(null);
  }, [stop, setVoiceToolCall]);

  // Stop voice whenever the user leaves realtime mode (mode toggle, new chat, chat switch).
  useEffect(() => {
    if (!isRealtimeSelected && isListening) {
      void stopVoice();
    }
  }, [isRealtimeSelected, isListening, stopVoice]);

  const startVoice = useCallback(async () => {
    // Guard against re-entrancy from auto-start, Start-audio button, and mic-switch effect.
    if (sessionBusyRef.current) return;
    sessionBusyRef.current = true;
    try {
      setIsConnecting(true);
      const realtimeModel = config.voice?.model;
      const transcribeModel = config.voice?.transcriber ?? config.stt?.model;
      const tools = await chatTools();
      const instructions = chatInstructions();
      const toolContextFactory = buildToolContextFactory(underlyingModelId);

      lastSessionSignatureRef.current = sessionSignature(instructions, tools);

      await start(
        realtimeModel,
        transcribeModel,
        instructions,
        messages,
        tools,
        inputDeviceId,
        outputDeviceId,
        (level) => {
          const now = Date.now();
          if (now - lastLevelUpdateRef.current > 80) {
            lastLevelUpdateRef.current = now;
            setAudioLevel(level);
          }
        },
        toolContextFactory,
        // Flip to "listening" only once recording has actually started.
        () => {
          setIsConnecting(false);
          setIsListening(true);
        },
      );
      activeInputDeviceRef.current = inputDeviceId;
    } catch (error) {
      console.error("Failed to start voice mode:", error);
      const errorMessage = error?.toString() || "";
      if (errorMessage.includes("API key") || errorMessage.includes("401")) {
        notify.error("Voice mode unavailable", "An OpenAI API key must be configured to use voice mode.");
      } else {
        notify.error("Couldn't start voice mode", "Check your microphone permissions and try again.");
      }
      setIsConnecting(false);
      sessionBusyRef.current = false;
    }
  }, [
    buildToolContextFactory,
    chatInstructions,
    chatTools,
    underlyingModelId,
    start,
    messages,
    config.voice?.model,
    config.voice?.transcriber,
    config.stt?.model,
    inputDeviceId,
    outputDeviceId,
  ]);

  // Restart when the user picks a different mic while listening (recorder is bound at start()).
  useEffect(() => {
    if (!isListening) return;
    if (activeInputDeviceRef.current === inputDeviceId) return;
    // Record target up front so this effect doesn't re-fire during restart.
    activeInputDeviceRef.current = inputDeviceId;
    void (async () => {
      await stop();
      setIsListening(false);
      // Clear busy guard so the restart isn't blocked by re-entrancy protection.
      sessionBusyRef.current = false;
      await startVoice();
    })();
  }, [inputDeviceId, isListening, stop, startVoice]);

  const sendVoiceText = useCallback(
    (text: string) => {
      void addMessage({ role: Role.User, content: [{ type: "text", text }] });
      sendText(text);
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
