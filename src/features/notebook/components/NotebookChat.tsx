import { ArrowRight, FileText, Globe, Loader2, MessageSquare, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Content } from "@/shared/types/chat";
import { getTextFromContent } from "@/shared/types/chat";
import { Markdown } from "@/shared/ui/Markdown";
import type { NotebookMessage, NotebookSource } from "../types/notebook";

interface NotebookChatProps {
  messages: NotebookMessage[];
  sources: NotebookSource[];
  isChatting: boolean;
  streamingContent: Content[] | null;
  onSend: (message: string) => void;
}

export function NotebookChat({ messages, sources, isChatting, streamingContent, onSend }: NotebookChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageCount = messages.length;
  const streamingPartCount = streamingContent?.length ?? 0;

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
                  <div className="flex items-center justify-center gap-6 text-xs text-neutral-400 dark:text-neutral-500">
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
          <div className="p-4 space-y-4">
            {messages.map((msg, i) => {
              const text = getTextFromContent(msg.content);
              return (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
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
      <div className="absolute bottom-4 left-4 right-4 z-20">
        <div className="flex items-end gap-2 bg-white/60 dark:bg-neutral-950/70 backdrop-blur-2xl rounded-2xl border border-neutral-200/50 dark:border-neutral-900 shadow-2xl shadow-black/60 dark:shadow-black/80 dark:ring-1 dark:ring-white/10 px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasSources ? "Ask about your sources..." : "Add sources first to start chatting"}
            disabled={!hasSources || isChatting}
            rows={1}
            className="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 outline-none resize-none min-h-[24px] max-h-[120px] disabled:opacity-50"
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
            className="p-1.5 rounded-lg bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 hover:opacity-80 transition-opacity disabled:opacity-30 shrink-0"
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
