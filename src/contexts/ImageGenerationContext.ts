import { createContext } from "react";
import type { Tool } from "../types/chat";

export interface ImageGenerationContextType {
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
  isAvailable: boolean;
  imageGenerationTools: () => Tool[];
  imageGenerationInstructions: () => string;
}

export const ImageGenerationContext = createContext<ImageGenerationContextType | undefined>(undefined);
