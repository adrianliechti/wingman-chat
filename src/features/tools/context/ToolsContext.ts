import { createContext } from "react";
import type { DisplayMode, DisplayModeOptions } from "@/features/settings/lib/mcp";
import type { SkillSources } from "@/features/skills/lib/skillsProvider";
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
    context: ToolContext,
    displayModeOptions?: DisplayModeOptions,
  ) => Promise<void>;
  /** Push a host-initiated display-mode change to a provider's active app. */
  setDisplayMode: (providerId: string, mode: DisplayMode) => void;
}

export const ToolsContext = createContext<ToolsContextValue | undefined>(undefined);
