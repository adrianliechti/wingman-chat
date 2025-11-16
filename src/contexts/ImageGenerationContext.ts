import { createContext } from "react";
import type { ToolProvider } from "../types/chat";

export interface ImageGenerationContextType {
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
  isAvailable: boolean;
  imageGenerationProvider: () => ToolProvider | null;
}

export const ImageGenerationContext = createContext<ImageGenerationContextType | undefined>(undefined);
