import { createContext } from "react";

export interface VoiceContextType {
  isAvailable: boolean;
  isListening: boolean;
  startVoice: () => Promise<void>;
  stopVoice: () => Promise<void>;
}

export const VoiceContext = createContext<VoiceContextType | undefined>(undefined);
