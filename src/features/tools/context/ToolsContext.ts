import { createContext } from "react";
import type { McpAppOptions, McpAppSession } from "@/features/settings/lib/mcpAppSession";
import type { SkillSources } from "@/features/skills/lib/skillsProvider";
import type {
  AudioContent,
  FileContent,
  ImageContent,
  ProviderState,
  TextContent,
  ToolProvider,
} from "@/shared/types/chat";

export interface ToolsContextValue {
  providers: ToolProvider[];
  getProviderState: (id: string) => ProviderState;
  /** Whether the active agent locks this tool on ("required") or leaves it user-toggleable ("optional"). */
  getProviderPolicy: (id: string) => "required" | "optional";
  setProviderEnabled: (id: string, enabled: boolean) => Promise<void>;
  setModelOverrides: (enabled: string[], disabled: string[]) => void;
  /** Which sources the global Skills tool exposes (personal and/or catalog). */
  skillSources: SkillSources;
  setSkillSources: (sources: SkillSources) => void;
  companionAvailable: boolean;
  companionEnabled: boolean;
  toggleCompanion: () => void;
  restoreToolUI: (
    providerId: string,
    toolName: string,
    resourceUri: string,
    args: Record<string, unknown>,
    result: (TextContent | ImageContent | AudioContent | FileContent)[],
    content: Record<string, unknown> | undefined,
    options: McpAppOptions,
  ) => Promise<McpAppSession>;
}

export const ToolsContext = createContext<ToolsContextValue | undefined>(undefined);
