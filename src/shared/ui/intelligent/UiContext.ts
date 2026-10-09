import { createContext, type ReactNode } from "react";
import type { ActionHost, UiRuntime } from "@/shared/lib/intelligentUi/runtime";

export interface UiHostContext {
  runtime: UiRuntime;
  host: ActionHost;
  /** Render a Markdown string (the host's own renderer), for `text` content. */
  renderText?: (markdown: string) => ReactNode;
  /** The fence is still streaming: hide validation noise for components that are not finished. */
  streaming?: boolean;
}

export const UiContext = createContext<UiHostContext | null>(null);
