import { Transition } from "@headlessui/react";
import { ShieldQuestion, X } from "lucide-react";
import { Fragment } from "react";
import { useChat } from "@/features/chat/hooks/useChat";

export function ChatConsentOverlay() {
  const { pendingConsent, resolveConsent } = useChat();

  const isOpen = !!pendingConsent;

  return (
    <Transition
      as={Fragment}
      show={isOpen}
      enter="transition-opacity ease-out duration-200"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity ease-in duration-150"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <div className="absolute inset-0 z-30 bg-black/30 dark:bg-black/50">
        {pendingConsent && (
          <div className="absolute bottom-4 right-4 w-[calc(100%-2rem)] max-w-xs sm:w-80">
            <div className="rounded-xl bg-neutral-900/90 backdrop-blur text-neutral-100 shadow-lg ring-1 ring-white/10 p-4">
              <div className="flex items-start justify-between gap-2">
                <ShieldQuestion className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => resolveConsent({ action: "decline" })}
                  className="-mr-1 -mt-1 p-1 rounded text-neutral-400 hover:text-neutral-200 hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2">
                <div className="text-sm font-semibold">{pendingConsent.categoryName}</div>
                <div className="mt-1 text-sm text-neutral-300 whitespace-pre-wrap">
                  {pendingConsent.consent.message}
                </div>
              </div>
              <button
                type="button"
                onClick={() => resolveConsent({ action: "accept" })}
                className="mt-4 w-full inline-flex items-center justify-center px-3 py-2 text-sm font-medium rounded-md bg-black hover:bg-neutral-800 text-neutral-100 ring-1 ring-white/10 transition-colors"
              >
                Noted
              </button>
            </div>
          </div>
        )}
      </div>
    </Transition>
  );
}
