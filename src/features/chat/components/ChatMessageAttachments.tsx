import { useEffect, useRef, useState, type ReactNode } from "react";
import { getTextFromContent, type Message } from "@/shared/types/chat";
import { useChatList } from "../hooks/useChat";
import { createAttachmentLoader } from "../lib/chatAttachments";

/** Read saved media only when its message approaches the viewport. */
export function ChatMessageAttachments({
  message,
  children,
}: {
  message: Message;
  children: (loaded: Message) => ReactNode;
}) {
  const { chatId } = useChatList();
  const container = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ source: Message; chatId: string; message?: Message; error?: string } | null>(
    null,
  );
  useEffect(() => {
    if (!chatId || !container.current) return;
    const controller = new AbortController();
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void createAttachmentLoader(chatId)([message], controller.signal)
          .then(([loaded]) => {
            if (!controller.signal.aborted) setResult({ source: message, chatId, message: loaded });
          })
          .catch((error) => {
            if (!controller.signal.aborted)
              setResult({
                source: message,
                chatId,
                error: error instanceof Error ? error.message : "Couldn't load attachment",
              });
          });
      },
      { rootMargin: "400px" },
    );
    observer.observe(container.current);
    return () => {
      controller.abort();
      observer.disconnect();
    };
  }, [chatId, message]);
  const current = result?.source === message && result.chatId === chatId ? result : null;
  return (
    <div ref={container}>
      {current?.message ? (
        children(current.message)
      ) : (
        <div className="min-h-24 py-3 text-sm text-neutral-500">
          <p className="whitespace-pre-wrap">{getTextFromContent(message.content)}</p>
          <p role={current?.error ? "alert" : "status"}>{current?.error ?? "Loading attachments…"}</p>
        </div>
      )}
    </div>
  );
}
