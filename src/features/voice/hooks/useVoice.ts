import { useContext } from "react";
import { VoiceContext } from "@/features/voice/context/VoiceContext";
import type { VoiceContextType } from "@/features/voice/context/VoiceContext";

export function useVoice(): VoiceContextType {
  const context = useContext(VoiceContext);
  if (context === undefined) {
    throw new Error('useVoice must be used within a VoiceProvider');
  }
  return context;
}
