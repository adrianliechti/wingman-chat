import { createContext } from "react";
import type { Tool } from "../types/chat";

export interface SearchContextType {
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
  isAvailable: boolean;
  searchTools: () => Tool[];
  searchInstructions: () => string;
}

export const SearchContext = createContext<SearchContextType | undefined>(undefined);
