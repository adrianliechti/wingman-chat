import { createContext } from "react";
import type { ToolProvider } from "../types/chat";

export interface RendererContextType {
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
  isAvailable: boolean;
  rendererProvider: () => ToolProvider | null;
}

export const RendererContext = createContext<RendererContextType | undefined>(undefined);
