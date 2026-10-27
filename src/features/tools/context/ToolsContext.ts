import { createContext } from "react";
import type { McpAppOptions, McpAppData } from "@/features/settings/lib/mcpAppSession";
import type { SkillSources, SkillsToolProvider } from "@/features/skills/lib/skillsProvider";
import type { ToolResultPart, UIResourcePart } from "@tanstack/ai";
import type { ProviderState, ToolProvider } from "@/shared/types/chat";

export interface ToolsContextValue {
  providers: ToolProvider[];
  /** Always-on providers that are never user-toggleable and bypass model tool filters (e.g. Skill Builder). */
  coreProviders: ToolProvider[];
  /** Selected independently of connection or authentication status. */
  isProviderEnabled: (id: string) => boolean;
  getProviderState: (id: string) => ProviderState;
  /** Whether the active agent locks this tool on ("required") or leaves it user-toggleable ("optional"). */
  getProviderPolicy: (id: string) => "required" | "optional";
  setProviderEnabled: (id: string, enabled: boolean) => Promise<void>;
  setModelOverrides: (enabled: string[], disabled: string[]) => void;
  /** Which sources the global Skills tool exposes (personal and/or catalog). */
  skillSources: SkillSources;
  setSkillSources: (sources: SkillSources) => void;
  /** Extend automatic skills with this conversation's explicit selections. */
  getSkillsProvider: (names: readonly string[]) => SkillsToolProvider | null;
  companionAvailable: boolean;
  companionEnabled: boolean;
  toggleCompanion: () => void;
  restoreToolUI: (
    app: UIResourcePart,
    args: Record<string, unknown>,
    result: ToolResultPart,
    options: McpAppOptions,
  ) => Promise<McpAppData>;
}

export const ToolsContext = createContext<ToolsContextValue | undefined>(undefined);
