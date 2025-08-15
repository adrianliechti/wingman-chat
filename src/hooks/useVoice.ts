import { useContext } from "react";
import { VoiceContext } from "../contexts/VoiceContext";
import type { VoiceContextType } from "../contexts/VoiceContext";

export function useVoice(): VoiceContextType {
  const context = useContext(VoiceContext);
  if (context === undefined) {
    throw new Error('useVoice must be used within a VoiceProvider');
  }
  return context;
}
