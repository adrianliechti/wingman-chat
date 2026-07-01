import { Check, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useChat } from "@/features/chat/hooks/useChat";
import { cn } from "@/shared/lib/cn";
import type { RiskSeverity } from "@/shared/types/elicitation";
import { useLayout } from "@/shell/hooks/useLayout";

export function ChatConsentBackdrop() {
  const { pendingConsent } = useChat();
  if (!pendingConsent) return null;
  return <div className="fixed inset-0 z-[60] bg-white/60 dark:bg-black/60 backdrop-blur-[2px] pointer-events-auto" />;
}

export function ChatConsentBanner() {
  const { pendingConsent, resolveConsent } = useChat();
  const { layoutMode } = useLayout();
  if (!pendingConsent) return null;

  const isRisk = pendingConsent.kind === "risk";
  const tone = isRisk ? severityTone(pendingConsent.consent.severity ?? "medium") : neutralTone();
  const Icon = isRisk ? ShieldAlert : ShieldQuestion;

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-[60] bg-neutral-50/85 dark:bg-neutral-950/85 backdrop-blur-sm border-t border-neutral-200/60 dark:border-neutral-800/60 shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.08)]">
      <div
        className={cn(
          "px-3 pt-5 pb-10 relative",
          layoutMode === "wide" ? "max-w-full md:max-w-[80vw] mx-auto" : "max-content-width",
        )}
      >
        <Icon className={cn("hidden md:block absolute right-full top-5 mr-3 w-5 h-5", tone.icon)} />
        <div className={cn("text-sm font-semibold", tone.title)}>{pendingConsent.name}</div>
        <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">
          {pendingConsent.consent.message}
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => resolveConsent({ action: "accept" })}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              tone.button,
            )}
          >
            <Check className="w-4 h-4" />
            Noted
          </button>
        </div>
      </div>
    </div>
  );
}

function neutralTone() {
  return {
    icon: "text-amber-600 dark:text-amber-400",
    title: "text-neutral-900 dark:text-neutral-100",
    button:
      "bg-neutral-100 hover:bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-300",
  };
}

function severityTone(severity: RiskSeverity) {
  switch (severity) {
    case "high":
      return {
        icon: "text-red-600 dark:text-red-400",
        title: "text-red-700 dark:text-red-300",
        button: "bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-950/40 dark:hover:bg-red-950/60 dark:text-red-300",
      };
    case "low":
      return {
        icon: "text-sky-600 dark:text-sky-400",
        title: "text-sky-700 dark:text-sky-300",
        button: "bg-sky-50 hover:bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:hover:bg-sky-950/60 dark:text-sky-300",
      };
    default:
      return {
        icon: "text-amber-600 dark:text-amber-400",
        title: "text-amber-700 dark:text-amber-300",
        button:
          "bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:hover:bg-amber-950/60 dark:text-amber-300",
      };
  }
}
