import { Check, ShieldQuestion, X } from "lucide-react";
import { useChat } from "@/features/chat/hooks/useChat";

export function ChatConsentOverlay() {
  const { pendingConsent, resolveConsent } = useChat();

  if (!pendingConsent) return null;

  const { categoryName, consent } = pendingConsent;

  return (
    <div className="mb-2 rounded-lg border border-neutral-200/80 dark:border-neutral-700/80 bg-white/95 dark:bg-neutral-900/95 backdrop-blur shadow-sm px-3 py-2.5">
      <div className="flex items-start gap-2 min-w-0">
        <ShieldQuestion className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{categoryName}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 whitespace-pre-wrap">
            {consent.message}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => resolveConsent({ action: "accept" })}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-300 transition-colors"
            >
              <Check className="w-3 h-3" />
              Approve
            </button>
            <button
              type="button"
              onClick={() => resolveConsent({ action: "decline" })}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-300 transition-colors"
            >
              <X className="w-3 h-3" />
              Decline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
