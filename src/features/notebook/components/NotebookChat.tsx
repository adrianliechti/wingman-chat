import { ArrowRight, BookOpen, FileText, FlaskConical, Globe, Loader2, MessageSquare, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Content } from "@/shared/types/chat";
import { getTextFromContent } from "@/shared/types/chat";
import { Markdown } from "@/shared/ui/Markdown";
import type { NotebookMessage } from "../types/notebook";
import type { File } from "@/shared/types/file";

interface NotebookChatProps {
  messages: NotebookMessage[];
  sources: File[];
  isChatting: boolean;
  streamingContent: Content[] | null;
  onSend: (message: string) => void;
  showSourcesActive?: boolean;
  showStudioActive?: boolean;
  onShowSources?: () => void;
  onShowStudio?: () => void;
  isSearching?: boolean;
  outputCount?: number;
  isGeneratingOutput?: boolean;
}

export function NotebookChat({ messages, sources, isChatting, streamingContent, onSend, showSourcesActive, showStudioActive, onShowSources, onShowStudio, isSearching, outputCount, isGeneratingOutput }: NotebookChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageCount = messages.length;
  const streamingPartCount = streamingContent?.length ?? 0;
  const messageKeyCounts = new Map<string, number>();

  useEffect(() => {
    if (messageCount === 0 && streamingPartCount === 0) return;

    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messageCount, streamingPartCount]);

  const handleSubmit = () => {
    if (!input.trim() || isChatting) return;
    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasSources = sources.length > 0;
  const streamingText = streamingContent ? getTextFromContent(streamingContent) : "";

  return (
    <div className="h-full flex flex-col relative">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {messages.length === 0 && !streamingContent ? (
          <div className="h-full flex items-center justify-center p-8">
            <div className="text-center max-w-md">
              {hasSources ? (
                <>
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                    <MessageSquare size={22} className="text-neutral-400" />
                  </div>
                  <p className="text-neutral-600 dark:text-neutral-400 font-medium">Ask questions about your sources</p>
                  <p className="text-sm text-neutral-400 dark:text-neutral-500 mt-1">
                    The assistant can read and analyze your {sources.length} source{sources.length !== 1 ? "s" : ""}
                  </p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                    <Sparkles size={24} className="text-neutral-400" />
                  </div>
                  <p className="text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                    Start building your notebook
                  </p>
                  <p className="text-sm text-neutral-400 dark:text-neutral-500 mb-6 leading-relaxed">
                    Add sources from the web or upload files, then chat with your sources or generate outputs in the
                    studio.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-neutral-400 dark:text-neutral-500">
                    <div className="flex items-center gap-1.5">
                      <Globe size={13} />
                      <span>Web search</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <FileText size={13} />
                      <span>Upload files</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={13} />
                      <span>Generate outputs</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="p-4 pb-20 space-y-4">
            {messages.map((msg) => {
              const text = getTextFromContent(msg.content);
              const messageSignature = `${msg.timestamp}:${msg.role}:${text}`;
              const occurrence = (messageKeyCounts.get(messageSignature) ?? 0) + 1;
              messageKeyCounts.set(messageSignature, occurrence);

              return (
                <div
                  key={`${messageSignature}:${occurrence}`}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-4 py-2.5 ${msg.role === "user" ? "bg-neutral-200 dark:bg-neutral-900" : "bg-neutral-100 dark:bg-neutral-800"}`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
                        <Markdown>{text}</Markdown>
                      </div>
                    ) : (
                      <p className="text-sm">{text}</p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Streaming response */}
            {isChatting && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-xl px-4 py-2.5 bg-neutral-100 dark:bg-neutral-800">
                  {streamingText ? (
                    <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
                      <Markdown>{streamingText}</Markdown>
                    </div>
                  ) : (
                    <Loader2 size={16} className="text-neutral-400 animate-spin" />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating input */}
      <div className="absolute bottom-4 left-4 right-4 z-20 flex flex-col gap-2">
        {/* Mobile panel toggle chips — only visible on small screens */}
        {(onShowSources || onShowStudio) && (
          <div className="flex items-center gap-2 md:hidden px-1">
            {onShowSources && (
              <button
                type="button"
                onClick={onShowSources}
                className={`group flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 ${showSourcesActive
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 border-transparent shadow-md"
                  : "bg-white/70 dark:bg-neutral-900/70 backdrop-blur-sm text-neutral-600 dark:text-neutral-400 border-neutral-200/80 dark:border-neutral-700/80 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-800 dark:hover:text-neutral-200"
                  }`}
              >
                {isSearching ? (
                  <Loader2 size={12} className="animate-spin shrink-0" />
                ) : (
                  <BookOpen size={12} className="shrink-0" />
                )}
                <span>Sources</span>
                {sources.length > 0 && (
                  <span
                    className={`inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold leading-none ${showSourcesActive
                      ? "bg-white/25 dark:bg-black/20 text-white dark:text-neutral-900"
                      : "bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300"
                      }`}
                  >
                    {sources.length}
                  </span>
                )}
              </button>
            )}
            {onShowStudio && (
              <button
                type="button"
                onClick={onShowStudio}
                className={`group flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 ${showStudioActive
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 border-transparent shadow-md"
                  : "bg-white/70 dark:bg-neutral-900/70 backdrop-blur-sm text-neutral-600 dark:text-neutral-400 border-neutral-200/80 dark:border-neutral-700/80 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-800 dark:hover:text-neutral-200"
                  }`}
              >
                {isGeneratingOutput ? (
                  <Loader2 size={12} className="animate-spin shrink-0" />
                ) : (
                  <FlaskConical size={12} className="shrink-0" />
                )}
                <span>Output</span>
                {(outputCount ?? 0) > 0 && (
                  <span
                    className={`inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold leading-none ${showStudioActive
                      ? "bg-white/25 dark:bg-black/20 text-white dark:text-neutral-900"
                      : "bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300"
                      }`}
                  >
                    {outputCount}
                  </span>
                )}
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 bg-white/60 dark:bg-neutral-950/70 backdrop-blur-2xl rounded-2xl shadow-sm border-0 md:border border-t border-solid border-neutral-200/60 dark:border-neutral-700/60 px-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasSources ? "Ask about your sources..." : "Add sources first to start chatting"}
            disabled={!hasSources || isChatting}
            rows={1}
            className="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 outline-none resize-none py-2 max-h-30 disabled:opacity-50"
            style={{ height: "auto" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
            }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim() || isChatting || !hasSources}
            className="rounded-xl p-2 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors hover:bg-neutral-100/70 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
