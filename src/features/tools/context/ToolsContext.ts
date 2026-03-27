import { createContext } from "react";
import type { ToolProvider, ProviderState, TextContent, ImageContent, AudioContent, FileContent, ToolContext } from "@/shared/types/chat";

export interface ToolsContextValue {
  providers: ToolProvider[];
  getProviderState: (id: string) => ProviderState;
  setProviderEnabled: (id: string, enabled: boolean) => Promise<void>;
  setModelOverrides: (enabled: string[], disabled: string[]) => void;
  resetTools: () => void;
  restoreToolUI: (providerId: string, toolName: string, resourceUri: string, args: Record<string, unknown>, result: (TextContent | ImageContent | AudioContent | FileContent)[], context: ToolContext) => Promise<void>;
}

export const ToolsContext = createContext<ToolsContextValue | undefined>(undefined);
