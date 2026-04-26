import { useCallback, useRef, useState } from "react";
import { useChat } from "@/features/chat/hooks/useChat";
import { useChatContext } from "@/features/chat/hooks/useChatContext";
import { useVoiceWebSockets } from "@/features/voice/hooks/useVoiceWebSockets";
import { getConfig } from "@/shared/config";
import type { AudioContent, FileContent, ImageContent, TextContent } from "@/shared/types/chat";
import { Role } from "@/shared/types/chat";
import { useAudioDevices } from "@/shell/hooks/useAudioDevices";
import type { VoiceContextType } from "./VoiceContext";
import { VoiceContext } from "./VoiceContext";

interface VoiceProviderProps {
  children: React.ReactNode;
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
  const { addMessage, messages, chat, models, model: selectedModel, setVoiceToolCall } = useChat();
  const model = chat?.model ?? selectedModel ?? models[0];
  const { tools: chatTools, instructions: chatInstructions } = useChatContext("voice", model);
  const { inputDeviceId, outputDeviceId } = useAudioDevices();

  const onUserTranscript = useCallback(
    (text: string) => {
      let content = text;

      // Handle case where text might be a JSON string or object
      try {
        // First, check if it's already a string that looks like JSON
        if (typeof text === "string" && text.trim().startsWith("{")) {
          const parsed = JSON.parse(text);
          if (parsed.text) {
            content = parsed.text;
          } else if (typeof parsed === "string") {
            content = parsed;
          }
        }
      } catch {
        // If parsing fails, use the original text
        content = text;
      }

      // Additional check: if content is still an object, try to extract text
      if (typeof content === "object" && content !== null && "text" in content) {
        content = (content as { text: string }).text;
      }

      console.log("User transcript:", { original: text, processed: content });

      if (content.trim()) {
        addMessage({ role: Role.User, content: [{ type: "text", text: content }] });
      }
    },
    [addMessage],
  );

  const onAssistantTranscript = useCallback(
    (text: string) => {
      let content = text;

      // Handle case where text might be a JSON string or object
      try {
        // First, check if it's already a string that looks like JSON
        if (typeof text === "string" && text.trim().startsWith("{")) {
          const parsed = JSON.parse(text);
          if (parsed.text) {
            content = parsed.text;
          } else if (typeof parsed === "string") {
            content = parsed;
          }
        }
      } catch {
        // If parsing fails, use the original text
        content = text;
      }

      // Additional check: if content is still an object, try to extract text
      if (typeof content === "object" && content !== null && "text" in content) {
        content = (content as { text: string }).text;
      }

      console.log("Assistant transcript:", { original: text, processed: content });

      if (content.trim()) {
        addMessage({ role: Role.Assistant, content: [{ type: "text", text: content }] });
      }
    },
    [addMessage],
  );

  const onToolCall = useCallback(
    (toolName: string) => {
      setVoiceToolCall(toolName);
    },
    [setVoiceToolCall],
  );

  const onToolCallDone = useCallback(() => {
    setVoiceToolCall(null);
  }, [setVoiceToolCall]);

  const onToolResult = useCallback(
    (toolName: string, callId: string, result: (TextContent | ImageContent | AudioContent | FileContent)[]) => {
      // Persist the raw result (including images) as a user message with a tool_result part
      addMessage({
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
    },
    [addMessage],
  );

  const { start, stop, sendText } = useVoiceWebSockets(
    onUserTranscript,
    onAssistantTranscript,
    onToolCall,
    onToolCallDone,
    onToolResult,
  );

  const stopVoice = useCallback(async () => {
    await stop();
    setIsListening(false);
    setAudioLevel(0);
    setVoiceToolCall(null);
  }, [stop, setVoiceToolCall]);

  const startVoice = useCallback(async () => {
    try {
      const realtimeModel = config.voice?.model;
      const transcribeModel = config.voice?.transcriber ?? config.stt?.model;
      await start(
        realtimeModel,
        transcribeModel,
        chatInstructions(),
        messages,
        await chatTools(),
        inputDeviceId,
        outputDeviceId,
        (level) => {
          const now = Date.now();
          if (now - lastLevelUpdateRef.current > 80) {
            lastLevelUpdateRef.current = now;
            setAudioLevel(level);
          }
        },
      );
      setIsListening(true);
    } catch (error) {
      console.error("Failed to start voice mode:", error);
      // Show user-friendly error if API key is missing
      const errorMessage = error?.toString() || "";
      if (errorMessage.includes("API key") || errorMessage.includes("401")) {
        alert("Voice mode requires an OpenAI API key to be configured. Please add your API key to the configuration.");
      } else {
        alert("Failed to start voice mode. Please check your microphone permissions and try again.");
      }
    }
  }, [
    chatInstructions,
    chatTools,
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
