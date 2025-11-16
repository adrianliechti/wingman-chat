import { createContext } from "react";
import type { ToolProvider } from "../types/chat";

export interface InterpreterContextType {
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
  isAvailable: boolean;
  interpreterProvider: () => ToolProvider | null;
}

export const InterpreterContext = createContext<InterpreterContextType | undefined>(undefined);
