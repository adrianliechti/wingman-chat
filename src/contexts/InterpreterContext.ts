import { createContext } from "react";
import type { Tool } from "../types/chat";

export interface InterpreterContextType {
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
  isAvailable: boolean;
  interpreterTools: () => Tool[];
  interpreterInstructions: () => string;
}

export const InterpreterContext = createContext<InterpreterContextType | undefined>(undefined);
