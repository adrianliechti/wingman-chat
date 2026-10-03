import { Fragment, useEffect, useRef, useState, type FragmentInstance, type ReactNode } from "react";
import type { UIMessage } from "@tanstack/ai";
import { messageText } from "@/shared/lib/messages";
import { useChatList } from "../hooks/useChat";
import { createAttachmentLoader } from "../lib/chatAttachments";

/** Read saved media only when its message approaches the viewport. */
export function ChatMessageAttachments({
  message,
  children,
}: {
  message: UIMessage;
  children: (loaded: UIMessage) => ReactNode;
}) {
  const { chatId } = useChatList();
  const container = useRef<FragmentInstance>(null);
  const [result, setResult] = useState<{
    source: UIMessage;
    chatId: string;
    message?: UIMessage;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!chatId || !container.current) return;
    const fragment = container.current;
    const controller = new AbortController();
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        fragment.unobserveUsing(observer);
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
    fragment.observeUsing(observer);
    return () => {
      controller.abort();
      fragment.unobserveUsing(observer);
      observer.disconnect();
    };
  }, [chatId, message]);
  const current = result && result.source === message && result.chatId === chatId ? result : null;
  return (
    <Fragment ref={container}>
      {current?.message ? (
        children(current.message)
      ) : (
        <div className="min-h-24 py-3 text-sm text-neutral-500">
          <p className="whitespace-pre-wrap">{messageText(message)}</p>
          <p role={current?.error ? "alert" : "status"}>{current?.error ?? "Loading attachments…"}</p>
        </div>
      )}
    </Fragment>
  );
}
