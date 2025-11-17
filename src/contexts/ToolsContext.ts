import { createContext } from "react";
import type { ToolProvider } from "../types/chat";

export interface ToolsContextType {
  providers: ToolProvider[];
}

export const ToolsContext = createContext<ToolsContextType | undefined>(undefined);
