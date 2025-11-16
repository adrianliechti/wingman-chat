import { createContext } from "react";
import type { ToolProvider } from "../types/chat";

export interface SearchContextType {
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
  isAvailable: boolean;
  searchProvider: () => ToolProvider | null;
}

export const SearchContext = createContext<SearchContextType | undefined>(undefined);
