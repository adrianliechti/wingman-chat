import type { UIMessage } from "@tanstack/ai";
import { Drill, Loader2 } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { extractUiFences, parseMessages, type UiBlock } from "@/shared/lib/inlineUi/protocol";
import { EMPTY_UI_SNAPSHOT, InlineUiRuntime, type UiSubmission } from "@/shared/lib/inlineUi/runtime";
import { CodeRenderer } from "@/shared/ui/CodeRenderer";
import { CopyButton } from "@/shared/ui/CopyButton";
import { PreviewButton } from "@/shared/ui/PreviewButton";
import { RendererActionsContext } from "@/shared/ui/renderers/RendererFrame";
import { InlineUiViewContext, NodeView, useSignalValue } from "./NodeView";
import { UiError } from "./UiFeedback";
import type { NodeResolver } from "@a2ui/web_core/v1_0";

const RuntimeContext = createContext<InlineUiRuntime | null>(null);
const ProviderContext = createContext(false);

export function conversationUiBlocks(messages: UIMessage[], owner: string, streaming: boolean): UiBlock[] {
  return messages.flatMap((message, index) =>
    message.role !== "assistant"
      ? []
      : message.parts.flatMap((part, partIndex) => {
          if (part.type !== "text") return [];
          const partial = streaming && index === messages.length - 1;
          return extractUiFences(part.content).map((source, blockIndex) => ({
            key: JSON.stringify([JSON.stringify([owner, message.id, partIndex]), String(blockIndex)]),
            source,
            streaming: partial,
          }));
        }),
  );
}

export function InlineUiProvider({
  owner,
  blocks,
  onSubmit,
  children,
}: {
  owner?: string;
  blocks: readonly UiBlock[];
  onSubmit?: (submission: UiSubmission) => void | Promise<void>;
  children: ReactNode;
}) {
  const [runtime, setRuntime] = useState<InlineUiRuntime | null>(null);
  useEffect(() => {
    const instance = new InlineUiRuntime(owner);
    setRuntime(instance);
    return () => instance.dispose();
  }, [owner]);
  useEffect(() => {
    if (runtime && runtime.owner === owner) {
      runtime.onSubmit = onSubmit;
      runtime.sync(blocks);
    }
  }, [runtime, owner, blocks, onSubmit]);
  return (
    <ProviderContext value={true}>
      <RuntimeContext value={runtime}>{children}</RuntimeContext>
    </ProviderContext>
  );
}

export function ConversationUiProvider({
  owner,
  messages,
  streaming,
  onSubmit,
  children,
}: {
  owner: string;
  messages: UIMessage[];
  streaming: boolean;
  onSubmit: (submission: UiSubmission) => void | Promise<void>;
  children: ReactNode;
}) {
  const blocks = useMemo(() => conversationUiBlocks(messages, owner, streaming), [messages, owner, streaming]);
  return (
    <InlineUiProvider key={owner} owner={owner} blocks={blocks} onSubmit={onSubmit}>
      {children}
    </InlineUiProvider>
  );
}

export interface UiRendererProps {
  source: string;
  stateKey?: string;
  isStreaming?: boolean;
  onSendMessage?: (text: string) => void;
  renderText?: (markdown: string) => ReactNode;
}

export function UiRenderer(props: UiRendererProps) {
  const provided = useContext(ProviderContext);
  // Standalone Markdown previews get their own isolated surface namespace.
  const blocks = useMemo(
    () => [{ key: props.stateKey ?? "standalone", source: props.source, streaming: props.isStreaming }],
    [props.stateKey, props.source, props.isStreaming],
  );
  const onSubmit = useMemo(
    () =>
      props.onSendMessage ? (submission: UiSubmission) => props.onSendMessage?.(JSON.stringify(submission)) : undefined,
    [props.onSendMessage],
  );
  if (!provided)
    return (
      <InlineUiProvider key={props.stateKey} owner={props.stateKey} blocks={blocks} onSubmit={onSubmit}>
        <UiBlockView {...props} />
      </InlineUiProvider>
    );
  return <UiBlockView {...props} />;
}

const emptySubscribe = () => () => {};
const emptySnapshot = () => EMPTY_UI_SNAPSHOT;
function UiBlockView({ source, stateKey, isStreaming = false, renderText }: UiRendererProps) {
  const runtime = useContext(RuntimeContext);
  const snapshot = useSyncExternalStore(
    runtime?.subscribe ?? emptySubscribe,
    runtime?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
  const actions = useContext(RendererActionsContext);
  const [showCode, setShowCode] = useState(false);
  const parsed = useMemo(() => parseMessages(source, isStreaming), [source, isStreaming]);
  const view = useMemo(() => ({ streaming: isStreaming, renderText }), [isStreaming, renderText]);
  const ids = parsed.messages.flatMap((message) =>
    "createSurface" in message ? [message.createSurface.surfaceId] : [],
  );
  const error = parsed.error ?? snapshot.errors.get(stateKey ?? "standalone") ?? snapshot.errors.get("session");
  return (
    <div className="group/ui relative my-4 min-w-0" aria-busy={isStreaming}>
      {actions && (
        <div className="mb-2 flex justify-end gap-2 opacity-0 group-hover/ui:opacity-100 focus-within:opacity-100">
          <PreviewButton showCode={showCode} onToggle={() => setShowCode((value) => !value)} label />
          <CopyButton text={source} label="Copy" />
        </div>
      )}
      {error && (
        <UiError title="This interface could not be displayed." detail={error} source={showCode ? undefined : source} />
      )}
      {showCode ? (
        <CodeRenderer code={source} language="json" />
      ) : (
        !error && (
          <InlineUiViewContext value={view}>
            {ids.map((id) => {
              const resolver = snapshot.resolvers.get(id);
              return resolver ? (
                <div key={id}>
                  {snapshot.actionErrors.has(id) && (
                    <UiError title="This action could not be completed." detail={snapshot.actionErrors.get(id)!} />
                  )}
                  {snapshot.errors.has(id) && (
                    <UiError
                      title="Some parts of this interface could not be displayed."
                      detail={snapshot.errors.get(id)!}
                    />
                  )}
                  <Surface resolver={resolver} />
                </div>
              ) : runtime ? (
                <p key={id} className="text-xs text-neutral-500">
                  Interface removed.
                </p>
              ) : (
                <BuildingInterface key={id} />
              );
            })}
            {!ids.length &&
              (parsed.pending || !parsed.messages.length ? (
                <BuildingInterface />
              ) : (
                <p className="text-xs text-neutral-500">Interface updated.</p>
              ))}
          </InlineUiViewContext>
        )
      )}
    </div>
  );
}

function Surface({ resolver }: { resolver: NodeResolver }) {
  const root = useSignalValue(resolver.rootNode);
  return root ? <NodeView key={root.id} node={root} /> : <BuildingInterface />;
}

function BuildingInterface() {
  return (
    <div
      role="status"
      className="grid grid-cols-[12px_minmax(0,1fr)] items-center gap-1.5 py-1 text-left text-xs text-neutral-500 dark:text-neutral-400"
    >
      <Loader2 aria-hidden="true" className="size-3 animate-spin text-neutral-400 dark:text-neutral-500" />
      <span className="flex min-w-0 items-center gap-2">
        <Drill aria-hidden="true" className="size-3 shrink-0 text-neutral-400 dark:text-neutral-500" />
        <span className="font-medium">Building interface…</span>
      </span>
    </div>
  );
}
