import { createContext } from "react";

export interface VoiceContextType {
  isAvailable: boolean;
  isListening: boolean;
  isConnecting: boolean;
  audioLevel: number;
  startVoice: () => Promise<void>;
  stopVoice: () => Promise<void>;
  sendText: (text: string) => void;
}

export const VoiceContext = createContext<VoiceContextType | undefined>(undefined);
