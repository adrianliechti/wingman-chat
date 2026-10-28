import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { ArtifactBridge, resolveCapabilities } from "@/features/artifacts/lib/artifactBridge";
import { ToolsContext } from "@/features/tools/context/ToolsContext";
import { getModel } from "@/features/tools/lib/llmCommand";
import { getConfig } from "@/shared/config";
import { confirm } from "@/shared/lib/confirm";
import type { PreviewSession } from "@/shared/lib/htmlPreviewSession";
import { ProviderState, type Tool } from "@/shared/types/chat";
import { HtmlPreview } from "@/shared/ui/HtmlPreview";
import type { TextSelectionSnapshot } from "@/shared/ui/selection/useTextSelection";
import sdkSource from "virtual:artifact-library-source/wingman-sdk";
import { DraftSourceEditor } from "./SourceEditor";
import { useTextDraft, type FileEditing } from "./useTextDraft";

interface HtmlEditorProps {
  path: string;
  content: string;
  viewMode?: "code" | "preview";
  onViewModeChange?: (mode: "code" | "preview") => void;
  /** Receives the preview iframe whose text selection the host watches. */
  onSelectionRoot?: (element: HTMLElement | null) => void;
  /** How the file is saved; without it the editor is read-only. */
  editing?: FileEditing;
  /** Sends an instruction about code selected in the code view. */
  onAsk?: (instruction: string, selection: TextSelectionSnapshot) => void;
}

/** Providers a page must not drive: the model's own file tools, memory, and skills. */
const EXCLUDED_PROVIDERS = new Set(["artifacts", "memory", "skills"]);

const NO_TOOLS: Tool[] = [];

export function HtmlEditor({
  path,
  content,
  viewMode = "preview",
  onSelectionRoot,
  editing,
  onAsk,
}: HtmlEditorProps) {
  const { fs } = useArtifacts();
  const draft = useTextDraft(content, editing);
  const toolsContext = useContext(ToolsContext);
  const config = getConfig();
  const bridgeEnabled = config.artifacts?.bridge !== false && !!fs;

  const tools = useMemo(() => {
    if (!toolsContext?.getProviderState) return NO_TOOLS;
    return toolsContext.providers
      .filter(
        (provider) =>
          !EXCLUDED_PROVIDERS.has(provider.id) &&
          toolsContext.getProviderState(provider.id) === ProviderState.Connected,
      )
      .flatMap((provider) => provider.tools);
  }, [toolsContext]);
  const toolsRef = useRef(tools);
  useLayoutEffect(() => {
    toolsRef.current = tools;
  });

  const hasTools = tools.length > 0;
  const capabilities = useMemo(() => resolveCapabilities(config, { tools: hasTools }), [config, hasTools]);
  const sdk = useMemo(
    () => (bridgeEnabled ? { source: sdkSource, capabilities } : undefined),
    [bridgeEnabled, capabilities],
  );

  const bridgeRef = useRef<ArtifactBridge | null>(null);
  useEffect(() => {
    bridgeRef.current?.setCapabilities(capabilities);
  }, [capabilities]);
  useEffect(
    () => () => {
      bridgeRef.current?.detach();
      bridgeRef.current = null;
    },
    [],
  );

  const onSession = useCallback(
    (session: PreviewSession | null, iframe: HTMLIFrameElement | null) => {
      bridgeRef.current?.detach();
      bridgeRef.current = null;
      if (!session || !iframe || !fs || !bridgeEnabled) return;
      const bridge = new ArtifactBridge({
        fs,
        path,
        capabilities,
        tools: () => toolsRef.current,
        model: getModel,
        consent: (names) =>
          confirm({
            title: "Allow this artifact to use chat tools?",
            message: `${path} wants to call: ${names.join(", ")}`,
            confirmLabel: "Allow",
          }),
      });
      bridge.attach(iframe, session.token);
      bridgeRef.current = bridge;
    },
    [fs, path, bridgeEnabled, capabilities],
  );

  // A file the page wrote itself is updated in the session without reloading the page.
  const shouldReload = useCallback((changed: string) => !bridgeRef.current?.isWriting(changed), []);

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {viewMode === "preview" ? (
        <HtmlPreview
          path={path}
          content={draft.text}
          fs={fs ?? undefined}
          className="w-full h-full"
          sdk={sdk}
          onSession={onSession}
          shouldReload={shouldReload}
          iframeRef={onSelectionRoot}
        />
      ) : (
        <DraftSourceEditor draft={draft} language="html" label="HTML source" onAsk={onAsk} />
      )}
    </div>
  );
}
