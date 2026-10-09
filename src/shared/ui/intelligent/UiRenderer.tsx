import { useSelector } from "@tanstack/react-store";
import { AlertTriangle } from "lucide-react";
import { memo, type ReactNode, useContext, useMemo } from "react";
import { confirm } from "@/shared/lib/confirm";
import { copyToClipboard } from "@/shared/lib/copy";
import { type ActionHost, createUiRuntime, getUiRuntime, type UiRuntime } from "@/shared/lib/intelligentUi/runtime";
import { collectUnresolvedReferences, parseUiDocument } from "@/shared/lib/intelligentUi/schema";
import { notify } from "@/shared/lib/notify";
import { CodeRenderer } from "@/shared/ui/CodeRenderer";
import { CopyButton } from "@/shared/ui/CopyButton";
import { PreviewButton } from "@/shared/ui/PreviewButton";
import { RendererActionsContext } from "@/shared/ui/renderers/RendererFrame";
import { UiContext, type UiHostContext } from "./UiContext";
import { UiNodeView } from "./UiNodeView";
import { useState } from "react";

export interface UiRendererProps {
  /** The ```ui fence body. */
  source: string;
  isStreaming?: boolean;
  /** Post a message to the chat as the user; buttons with a `send` action need it. */
  onSendMessage?: (text: string) => void;
  /** The host's Markdown renderer for `text` and `callout` bodies. */
  renderText?: (markdown: string) => ReactNode;
}

function ComputedErrors({ runtime }: { runtime: UiRuntime }) {
  const errors = useSelector(runtime.scope, (snapshot) => snapshot.errors);
  const unresolved = useMemo(() => collectUnresolvedReferences(runtime.document), [runtime.document]);
  const entries = Object.entries(errors);
  if (entries.length === 0 && unresolved.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-amber-700 dark:text-amber-400">
      {unresolved.length > 0 && (
        <li className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            Undeclared state {unresolved.length === 1 ? "key" : "keys"}:{" "}
            {unresolved.map((name, index) => (
              <span key={name}>
                {index > 0 && ", "}
                <code className="font-mono">{name}</code>
              </span>
            ))}
          </span>
        </li>
      )}
      {entries.map(([key, message]) => (
        <li key={key} className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            <code className="font-mono">{key}</code>: {message}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Renders a ```ui fence: a declarative component tree with reactive state.
 * Streaming prefixes render as previews with state controls and actions
 * disabled. A rejected document falls back to its JSON with the reason.
 */
export const UiRenderer = memo(function UiRenderer({
  source,
  isStreaming = false,
  onSendMessage,
  renderText,
}: UiRendererProps) {
  const actionsEnabled = useContext(RendererActionsContext);
  const [showCode, setShowCode] = useState(false);
  const parsed = useMemo(() => parseUiDocument(source, { streaming: isStreaming }), [source, isStreaming]);
  const streaming = isStreaming || parsed.status === "partial";
  // A finished document keeps its state across remounts and reloads; a streaming
  // preview gets a throwaway runtime, even when its JSON already parses.
  const runtime = useMemo(
    () =>
      parsed.status === "ok" || parsed.status === "partial"
        ? streaming
          ? createUiRuntime(parsed.document)
          : getUiRuntime(source, parsed.document)
        : null,
    [parsed, source, streaming],
  );
  const host = useMemo<ActionHost>(
    () => ({
      sendMessage: onSendMessage,
      copyText: (text) => copyToClipboard({ text }),
      openUrl: (url) => {
        window.open(url, "_blank", "noopener,noreferrer");
      },
      confirm: (message) => confirm(message),
      notify: (message, kind) => (kind === "error" ? notify.error(message) : notify.success(message)),
    }),
    [onSendMessage],
  );
  const context = useMemo<UiHostContext | null>(
    () => (runtime ? { runtime, host, renderText, streaming } : null),
    [runtime, host, renderText, streaming],
  );

  if (parsed.status === "incomplete") {
    return (
      <div className="my-4 flex h-24 items-center justify-center rounded-md bg-neutral-100 text-neutral-500 dark:bg-neutral-900/40">
        <div className="flex items-center space-x-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600 dark:border-neutral-600 dark:border-t-neutral-400" />
          <span>Building interface…</span>
        </div>
      </div>
    );
  }

  if (parsed.status === "error" || !runtime || !context) {
    return (
      <div className="my-4 flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Interface could not be rendered: {parsed.status === "error" ? parsed.message : "unknown error"}
        </p>
        <CodeRenderer code={source} language="json" />
      </div>
    );
  }

  const { document } = runtime;
  return (
    <div className="group/ui relative my-4 min-w-0">
      {(document.title || actionsEnabled) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {document.title ?? ""}
          </span>
          {actionsEnabled && (
            <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover/ui:opacity-100 focus-within:opacity-100">
              <PreviewButton showCode={showCode} onToggle={() => setShowCode((value) => !value)} label />
              <CopyButton text={source} label="Copy" />
            </div>
          )}
        </div>
      )}
      {showCode ? (
        <CodeRenderer code={source} language="json" />
      ) : (
        <UiContext value={context}>
          <div className="flex min-w-0 flex-col gap-3" aria-busy={streaming}>
            {document.children.map((node, index) => (
              <UiNodeView key={`${node.type}-${index}`} node={node} />
            ))}
            {!streaming && <ComputedErrors runtime={runtime} />}
          </div>
        </UiContext>
      )}
    </div>
  );
});
