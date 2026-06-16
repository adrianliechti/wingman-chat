import { AlertCircle, ChevronRight, Wrench } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useChat } from "@/features/chat/hooks/useChat";
import { useLastFullscreenApp } from "@/features/chat/hooks/useLastFullscreenApp";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { cn } from "@/shared/lib/cn";
import type { Content, Message, ToolResultContent } from "@/shared/types/chat";
import { CodeRenderer } from "@/shared/ui/CodeRenderer";
import { RenderContents } from "@/shared/ui/ContentRenderer";
import { McpProviderIcon } from "@/shared/ui/McpProviderIcon";
import { getToolCallPreview } from "./chatMessageUtils";
import { McpApp } from "./McpApp";
import { extractToolCode, toolPresentation } from "./toolDisplay";

type ChatToolMessageProps = {
  message: Message;
  index: number;
};

export const ChatToolMessage = memo(function ChatToolMessage({ message, index }: ChatToolMessageProps) {
  const [toolResultExpanded, setToolResultExpanded] = useState(false);
  const { chat, messages } = useChat();
  const { providers } = useToolsContext();
  const toolResultParts = message.content.filter((p) => p.type === "tool_result") as ToolResultContent[];
  const isLastFullscreenApp = useLastFullscreenApp(messages, index, toolResultParts);

  const toolResult = toolResultParts[0]; // Usually just one

  const toolDef = useMemo(() => {
    if (!toolResult?.name) return undefined;
    for (const provider of providers) {
      const tool = provider.tools.find((t) => t.name === toolResult.name);
      if (tool) return tool;
    }
    return undefined;
  }, [toolResult?.name, providers]);
  const toolIcon = toolDef?.icon;
  const isToolError = !!message.error;
  // When a result carries an MCP UI app, the app is the primary renderer; per the
  // MCP Apps spec the `content` blocks are for model context / text-only fallback,
  // so we don't also render the (redundant) media inline.
  //
  // We also require the app's provider to be registered: restoring a chat whose app
  // belongs to an inactive agent (or an MCP filtered out by RBAC) means the client
  // isn't available, so we fall back to the raw result instead of a broken app. Once
  // the provider appears (e.g. the agent is activated) this flips true and McpApp mounts.
  const appProviderId = toolResult?.meta?.toolProvider;
  const hasMcpApp =
    typeof appProviderId === "string" &&
    typeof toolResult?.meta?.toolResource === "string" &&
    providers.some((p) => p.id === appProviderId);
  const codeData = toolResult?.arguments ? extractToolCode(toolResult.arguments) : null;
  const pres = toolPresentation(toolResult?.name ?? "", toolResult?.arguments, { error: isToolError });
  const queryPreview =
    !pres.Icon && toolResult?.arguments ? getToolCallPreview(toolResult.name || "", toolResult.arguments) : null;

  // `read_skill` takes only a skill name (already shown in the header) and returns
  // JSON { name, description, instructions }. Drop the redundant arguments block and
  // show only the instructions, not the whole JSON envelope.
  const isReadSkill = toolResult?.name === "read_skill";
  const skillInstructions = useMemo(() => {
    if (!isReadSkill) return null;
    const textPart = toolResult?.result?.find((c) => c.type === "text");
    const text = textPart && textPart.type === "text" ? textPart.text : undefined;
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as { instructions?: unknown };
      return typeof parsed.instructions === "string" ? parsed.instructions : null;
    } catch {
      return null;
    }
  }, [isReadSkill, toolResult?.result]);

  // Helper to replace long data URLs with placeholder for display
  const sanitizeForDisplay = (obj: unknown): unknown => {
    if (typeof obj === "string") {
      // Replace data URLs with placeholder
      if (obj.startsWith("data:")) {
        const match = obj.match(/^data:([^;,]+)/);
        const mimeType = match ? match[1] : "unknown";
        return `[${mimeType} data]`;
      }
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitizeForDisplay);
    }
    if (obj && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = sanitizeForDisplay(value);
      }
      return result;
    }
    return obj;
  };

  const renderContent = (content: Content[], name?: string) => {
    // Check if all content is text
    const allText = content.every((c) => c.type === "text");
    if (allText && content.length === 1 && content[0].type === "text") {
      const text = content[0].text;
      // Try to parse as JSON
      try {
        const parsed = JSON.parse(text);
        const sanitized = sanitizeForDisplay(parsed);
        const formatted = JSON.stringify(sanitized, null, 2);
        return <CodeRenderer code={formatted} language="json" name={name} subtle />;
      } catch {
        // Not JSON, render as text
        return <CodeRenderer code={text} language="text" name={name} subtle />;
      }
    } else {
      // Content[] with mixed types - sanitize and stringify for display
      const sanitized = sanitizeForDisplay(content);
      const formatted = JSON.stringify(sanitized, null, 2);
      return <CodeRenderer code={formatted} language="json" name={name} subtle />;
    }
  };

  return (
    <div className="pb-2 max-w-full">
      <div className={cn("rounded-lg overflow-hidden max-w-full", isToolError && "bg-red-50/30 dark:bg-red-950/5")}>
        <button
          onClick={() => setToolResultExpanded(!toolResultExpanded)}
          className="w-full text-left transition-colors"
          type="button"
        >
          <div className="grid grid-cols-[12px_minmax(0,1fr)] items-center gap-1.5 min-w-0">
            <ChevronRight
              className={cn(
                "w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0 transition-transform",
                toolResultExpanded && "rotate-90",
              )}
            />
            <div className="flex items-center gap-2 min-w-0">
              {isToolError ? (
                <AlertCircle className="w-3 h-3 text-red-400 dark:text-red-500 shrink-0" />
              ) : pres.Icon ? (
                <pres.Icon className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0" />
              ) : toolIcon ? (
                <McpProviderIcon src={toolIcon} size={12} className="shrink-0 w-3 h-3 object-contain" />
              ) : (
                <Wrench className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0" />
              )}
              <span
                className={cn(
                  "text-xs whitespace-nowrap truncate",
                  pres.mono ? "font-mono" : "font-medium",
                  isToolError ? "text-red-500 dark:text-red-400" : "text-neutral-500 dark:text-neutral-400",
                )}
              >
                {isToolError && !pres.Icon ? "Tool Error" : !pres.Icon && toolDef?.title ? toolDef.title : pres.label}
              </span>
              {!pres.Icon && !toolResultExpanded && queryPreview && (
                <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate">
                  {queryPreview}
                </span>
              )}
            </div>
          </div>
        </button>

        {toolResultExpanded && (
          <div className="mt-1">
            {/* Input — skip read_skill's args; it's just the skill name, already in the header */}
            {!isReadSkill &&
              (codeData ? (
                <CodeRenderer code={codeData.code} language={codeData.language} />
              ) : (
                toolResult?.arguments && renderContent([{ type: "text", text: toolResult.arguments }], "Arguments")
              ))}
            {/* Output */}
            {message.error ? (
              <CodeRenderer code={message.error.message} language="text" name="Error" subtle />
            ) : isReadSkill && skillInstructions != null ? (
              <CodeRenderer code={skillInstructions} language="markdown" name="Instructions" subtle />
            ) : (
              toolResult?.result && renderContent(toolResult.result, "Result")
            )}
          </div>
        )}

        {/* Render media content (images, audio, files) — unless an MCP app owns the display */}
        {!hasMcpApp &&
          toolResult?.result?.some((c) => c.type === "image" || c.type === "audio" || c.type === "file") && (
            <div className="mt-2">
              <RenderContents contents={toolResult.result} />
            </div>
          )}

        {/* Render the MCP UI app (inline or fullscreen) for tool results with UI metadata */}
        {hasMcpApp && (
          <McpApp key={`${chat?.id}-${index}`} toolResult={toolResult} isLastFullscreenApp={isLastFullscreenApp} />
        )}
      </div>
    </div>
  );
});
