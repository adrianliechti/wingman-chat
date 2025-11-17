import { createContext } from "react";
import type { ToolProvider, ProviderState } from '../types/chat';

export interface ToolsContextValue {
  providers: ToolProvider[];
  getProviderState: (id: string) => ProviderState;
  setProviderEnabled: (id: string, enabled: boolean) => Promise<void>;
}

export const ToolsContext = createContext<ToolsContextValue | undefined>(undefined);
