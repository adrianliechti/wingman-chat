import { createContext } from "react";
import type { DisplayModeOptions } from "@/features/settings/lib/mcp";
import type {
  AudioContent,
  FileContent,
  ImageContent,
  ProviderState,
  TextContent,
  ToolContext,
  ToolProvider,
} from "@/shared/types/chat";

export interface ToolsContextValue {
  providers: ToolProvider[];
  getProviderState: (id: string) => ProviderState;
  setProviderEnabled: (id: string, enabled: boolean) => Promise<void>;
  setModelOverrides: (enabled: string[], disabled: string[]) => void;
  resetTools: () => void;
  restoreToolUI: (
    providerId: string,
    toolName: string,
    resourceUri: string,
    args: Record<string, unknown>,
    result: (TextContent | ImageContent | AudioContent | FileContent)[],
    context: ToolContext,
    displayModeOptions?: DisplayModeOptions,
  ) => Promise<void>;
  hasActiveBridge: (providerId: string) => boolean;
}

export const ToolsContext = createContext<ToolsContextValue | undefined>(undefined);
