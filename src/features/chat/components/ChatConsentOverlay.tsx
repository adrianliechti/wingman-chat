import { Check, ShieldQuestion } from "lucide-react";
import { useChat } from "@/features/chat/hooks/useChat";
import { cn } from "@/shared/lib/cn";
import { useLayout } from "@/shell/hooks/useLayout";

export function ChatConsentBackdrop() {
  const { pendingConsent } = useChat();
  if (!pendingConsent) return null;
  return <div className="absolute inset-0 z-10 bg-white/60 dark:bg-black/60 backdrop-blur-[2px] pointer-events-auto" />;
}

/**
 * Full-width bottom strip that replaces the chat input while a category consent is pending.
 * Background spans the chat area edge-to-edge; text content is padded to match the chat
 * message column (md:max-w-4xl mx-auto).
 *
 * Rendered inside the chat footer; uses negative margins to break out of the footer's
 * md:px-3 md:pb-4 spacing so it can sit flush against the chat-area edges.
 */
export function ChatConsentBanner() {
  const { pendingConsent, resolveConsent } = useChat();
  const { layoutMode } = useLayout();
  if (!pendingConsent) return null;

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 md:-inset-x-3 md:-bottom-4 bg-neutral-50/85 dark:bg-neutral-950/85 backdrop-blur-sm border-t border-neutral-200/60 dark:border-neutral-800/60 shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.08)]">
      <div
        className={cn(
          "px-3 pt-5 pb-10 relative",
          layoutMode === "wide" ? "max-w-full md:max-w-[80vw] mx-auto" : "max-content-width",
        )}
      >
        <ShieldQuestion className="hidden md:block absolute right-full top-5 mr-3 w-5 h-5 text-amber-600 dark:text-amber-400" />
        <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {pendingConsent.categoryName}
        </div>
        <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">
          {pendingConsent.consent.message}
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => resolveConsent({ action: "accept" })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-300 transition-colors"
          >
            <Check className="w-4 h-4" />
            Noted
          </button>
        </div>
      </div>
    </div>
  );
}
