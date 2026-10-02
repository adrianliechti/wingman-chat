import { ArrowDown, PictureInPicture2, Plus as PlusIcon } from "lucide-react";
import { ChatInput } from "@/features/chat/components/ChatInput";
import { ChatMessageList } from "@/features/chat/components/ChatMessageList";
import { useChat } from "@/features/chat/hooks/useChat";
import { useChatScroll } from "@/shared";

interface MiniChatProps {
  /** Return the chat to the main tab (closes the mini window). */
  onReturn: () => void;
  onNewChat: () => void;
}

/** Compact chat layout for the Picture-in-Picture window: header, messages, input. */
export function MiniChat({ onReturn, onNewChat }: MiniChatProps) {
  const { messages, chat, isResponding } = useChat();
  const scope = chat?.id ?? "__draft__";

  const { handleScrollContainerRef, handleSpacerRef, isAtBottom, goToLatest } = useChatScroll({
    resetKey: scope,
    messages,
    isResponding,
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b border-neutral-200/60 px-3 py-1.5 dark:border-white/10">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {chat?.title || "New chat"}
        </span>
        <button
          type="button"
          className="rounded p-1.5 text-neutral-600 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
          onClick={onNewChat}
          title="New chat"
        >
          <PlusIcon size={16} />
        </button>
        <button
          type="button"
          className="rounded p-1.5 text-neutral-600 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
          onClick={onReturn}
          title="Back to tab"
        >
          <PictureInPicture2 size={16} />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {messages.length === 0 ? (
          <div className="m-auto text-sm text-neutral-500 dark:text-neutral-400">Ask anything</div>
        ) : (
          <div className="flex-1 overflow-auto [overflow-anchor:none]" ref={handleScrollContainerRef}>
            <div className="px-2 pt-3 pb-2">
              <ChatMessageList scope={scope} />
              {/* Spacer — allows the last user message to scroll to the top */}
              <div ref={handleSpacerRef} aria-hidden="true" />
            </div>
          </div>
        )}

        {messages.length > 0 && !isAtBottom && (
          <button
            type="button"
            onClick={goToLatest}
            className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-neutral-200/80 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-neutral-700 shadow-sm backdrop-blur transition-colors hover:text-neutral-900 dark:border-neutral-700/80 dark:bg-neutral-900/95 dark:text-neutral-200 dark:hover:text-neutral-50"
            title="Follow latest response"
          >
            <ArrowDown size={14} />
            <span>Latest</span>
          </button>
        )}
      </div>

      <footer className="shrink-0 px-2 pb-2">
        <ChatInput />
      </footer>
    </div>
  );
}
