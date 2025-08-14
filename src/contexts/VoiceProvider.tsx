import { useState, useCallback, useEffect } from "react";
import { useVoiceWebSockets } from "../hooks/useVoiceWebSockets";
import { useChat } from "../hooks/useChat";
import { useChatContext } from "../hooks/useChatContext";
import { getConfig } from "../config";
import { Role } from "../types/chat";
import { VoiceContext, VoiceContextType } from './VoiceContext';

interface VoiceProviderProps {
  children: React.ReactNode;
}

export function VoiceProvider({ children }: VoiceProviderProps) {
  const [isListening, setIsListening] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const { addMessage, messages } = useChat();
  const { tools: chatTools, instructions: chatInstructions } = useChatContext();

  // Check voice availability from config
  useEffect(() => {
    try {
      const config = getConfig();
      setIsAvailable(config.voice);
    } catch (error) {
      console.warn('Failed to get voice config:', error);
      setIsAvailable(false);
    }
  }, []);

  const onUserTranscript = useCallback((text: string) => {
    let content = text;

    // Handle case where text might be a JSON string or object
    try {
      // First, check if it's already a string that looks like JSON
      if (typeof text === 'string' && text.trim().startsWith('{')) {
        const parsed = JSON.parse(text);
        if (parsed.text) {
          content = parsed.text;
        } else if (typeof parsed === 'string') {
          content = parsed;
        }
      }
    } catch {
      // If parsing fails, use the original text
      content = text;
    }

    // Additional check: if content is still an object, try to extract text
    if (typeof content === 'object' && content !== null && 'text' in content) {
      content = (content as { text: string }).text;
    }

    console.log('User transcript:', { original: text, processed: content });

    if (content.trim()) {
      addMessage({ role: Role.User, content });
    }
  }, [addMessage]);

  const onAssistantTranscript = useCallback((text: string) => {
    let content = text;

    // Handle case where text might be a JSON string or object
    try {
      // First, check if it's already a string that looks like JSON
      if (typeof text === 'string' && text.trim().startsWith('{')) {
        const parsed = JSON.parse(text);
        if (parsed.text) {
          content = parsed.text;
        } else if (typeof parsed === 'string') {
          content = parsed;
        }
      }
    } catch {
      // If parsing fails, use the original text
      content = text;
    }

    // Additional check: if content is still an object, try to extract text
    if (typeof content === 'object' && content !== null && 'text' in content) {
      content = (content as { text: string }).text;
    }

    console.log('Assistant transcript:', { original: text, processed: content });

    if (content.trim()) {
      addMessage({ role: Role.Assistant, content });
    }
  }, [addMessage]);

  const { start, stop } = useVoiceWebSockets(onUserTranscript, onAssistantTranscript);

  const stopVoice = useCallback(async () => {
    await stop();
    setIsListening(false);
  }, [stop]);

  const startVoice = useCallback(async () => {
    try {
      await start(undefined, undefined, chatInstructions, messages, chatTools);
      setIsListening(true);
    } catch (error) {
      console.error('Failed to start voice mode:', error);
      // Show user-friendly error if API key is missing
      const errorMessage = error?.toString() || '';
      if (errorMessage.includes('API key') || errorMessage.includes('401')) {
        alert('Voice mode requires an OpenAI API key to be configured. Please add your API key to the configuration.');
      } else {
        alert('Failed to start voice mode. Please check your microphone permissions and try again.');
      }
    }
  }, [chatInstructions, chatTools, start, messages]);

  const value: VoiceContextType = {
    isAvailable,
    isListening,
    startVoice,
    stopVoice,
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
