import { useCallback, useEffect, useRef, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useChat } from "@/features/chat/hooks/useChat";
import { useChatContext } from "@/features/chat/hooks/useChatContext";
import type { ToolContextFactory } from "@/features/voice/hooks/useVoiceWebSockets";
import { useVoiceWebSockets } from "@/features/voice/hooks/useVoiceWebSockets";
import { getConfig } from "@/shared/config";
import type { AudioContent, FileContent, ImageContent, TextContent, ToolContext } from "@/shared/types/chat";
import { Role } from "@/shared/types/chat";
import type { Elicitation } from "@/shared/types/elicitation";
import { useAudioDevices } from "@/shell/hooks/useAudioDevices";
import type { VoiceContextType } from "./VoiceContext";
import { VoiceContext } from "./VoiceContext";

interface VoiceProviderProps {
  children: React.ReactNode;
}

function parseTranscriptText(text: string): string {
  try {
    if (text.trim().startsWith("{")) {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && "text" in parsed) {
        return (parsed as { text: string }).text;
      }
      if (typeof parsed === "string") return parsed;
    }
  } catch {
    /* not JSON */
  }
  return text;
}

export function VoiceProvider({ children }: VoiceProviderProps) {
  const [isListening, setIsListening] = useState(false);
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
    setVoiceToolCall,
    requestElicitation,
    updateToolMeta,
  } = useChat();
  const { currentAgent } = useAgents();
  const model = chat?.model ?? selectedModel ?? models[0];
  const isRealtimeSelected = model?.id === "realtime" || currentAgent?.model === "realtime";

  const { tools: chatTools, instructions: chatInstructions } = useChatContext("voice", model);
  const { inputDeviceId, outputDeviceId } = useAudioDevices();

  const { start, stop, sendText, updateSession } = useVoiceWebSockets(
    onUserTranscriptCallback,
    onAssistantTranscriptCallback,
    onToolCallCallback,
    onToolCallDoneCallback,
    onToolResultCallback,
  );

  const addMessageRef = useRef(addMessage);
  addMessageRef.current = addMessage;
  const setVoiceToolCallRef = useRef(setVoiceToolCall);
  setVoiceToolCallRef.current = setVoiceToolCall;
  const requestElicitationRef = useRef(requestElicitation);
  requestElicitationRef.current = requestElicitation;
  const updateToolMetaRef = useRef(updateToolMeta);
  updateToolMetaRef.current = updateToolMeta;

  function onUserTranscriptCallback(text: string) {
    const content = parseTranscriptText(text);
    if (content.trim()) {
      addMessageRef.current({ role: Role.User, content: [{ type: "text", text: content }] });
    }
  }

  function onAssistantTranscriptCallback(text: string) {
    const content = parseTranscriptText(text);
    if (content.trim()) {
      addMessageRef.current({ role: Role.Assistant, content: [{ type: "text", text: content }] });
    }
  }

  function onToolCallCallback(toolName: string, callId: string) {
    setVoiceToolCallRef.current(toolName, callId);
  }

  function onToolCallDoneCallback() {
    setVoiceToolCallRef.current(null);
  }

  function onToolResultCallback(
    toolName: string,
    callId: string,
    result: (TextContent | ImageContent | AudioContent | FileContent)[],
  ) {
    addMessageRef.current({
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
            return requestElicitationRef.current(toolCall.id, toolCall.name, elicitation);
          },
        };
      },
    [],
  );

  const lastSessionSignatureRef = useRef<string>("");

  useEffect(() => {
    if (!isListening) return;
    const instructions = chatInstructions();
    chatTools()
      .then((tools) => {
        const signature = `${instructions.length}|${tools.map((t) => t.name).join(",")}`;
        if (signature === lastSessionSignatureRef.current) return;
        lastSessionSignatureRef.current = signature;
        const factory = buildToolContextFactory(
          models.find((m) => m.id !== "realtime" && (!m.type || m.type === "completer"))?.id,
        );
        updateSession(tools, instructions, factory);
      })
      .catch((err) => console.error("updateSession failed:", err));
  }, [isListening, chatTools, chatInstructions, updateSession, buildToolContextFactory, models]);

  const stopVoice = useCallback(async () => {
    await stop();
    setIsListening(false);
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
    try {
      const realtimeModel = config.voice?.model;
      const transcribeModel = config.voice?.transcriber ?? config.stt?.model;
      const tools = await chatTools();
      const instructions = chatInstructions();
      const underlyingModelId = models.find((m) => m.id !== "realtime" && (!m.type || m.type === "completer"))?.id;
      const toolContextFactory = buildToolContextFactory(underlyingModelId);

      lastSessionSignatureRef.current = `${instructions.length}|${tools.map((t) => t.name).join(",")}`;

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
      );
      setIsListening(true);
    } catch (error) {
      console.error("Failed to start voice mode:", error);
      const errorMessage = error?.toString() || "";
      if (errorMessage.includes("API key") || errorMessage.includes("401")) {
        alert("Voice mode requires an OpenAI API key to be configured. Please add your API key to the configuration.");
      } else {
        alert("Failed to start voice mode. Please check your microphone permissions and try again.");
      }
    }
  }, [
    buildToolContextFactory,
    chatInstructions,
    chatTools,
    models,
    start,
    messages,
    config.voice?.model,
    config.voice?.transcriber,
    config.stt?.model,
    inputDeviceId,
    outputDeviceId,
  ]);

  const sendVoiceText = useCallback(
    (text: string) => {
      addMessage({ role: Role.User, content: [{ type: "text", text }] });
      sendText(text);
    },
    [addMessage, sendText],
  );

  const value: VoiceContextType = {
    isAvailable,
    isListening,
    audioLevel,
    startVoice,
    stopVoice,
    sendText: sendVoiceText,
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
