import { createContext } from "react";
import type { Tool } from "../types/chat";

export interface ReplContextType {
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
  isAvailable: boolean;
  replTools: () => Tool[];
  replInstructions: () => string;
}

export const ReplContext = createContext<ReplContextType | undefined>(undefined);
