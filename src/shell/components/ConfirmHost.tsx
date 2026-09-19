import { Dialog } from "@headlessui/react";
import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { type ConfirmOptions, getConfirmRequest, settleConfirm, subscribeConfirm } from "@/shared/lib/confirm";

// Renders the app's single confirm dialog, driven by the `confirm()` store.
export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  useEffect(() => subscribeConfirm(() => setRequest(getConfirmRequest())), []);

  // Remove the portal as soon as the request settles. A leave transition can
  // otherwise retain its overlay when the underlying dialog closes or a tab's
  // animation frames are throttled.
  if (!request) return null;

  return (
    <Dialog open className="relative z-200" onClose={() => settleConfirm(false)}>
      <div className="fixed inset-0 bg-black/40 dark:bg-black/60" />

      <div className="fixed inset-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-md overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl transition-all">
            <div className="px-6 pt-5 pb-4">
              <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                {request.title}
              </Dialog.Title>
              {request.message && (
                <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">{request.message}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 bg-neutral-50/60 dark:bg-neutral-900/40 border-t border-neutral-200 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => settleConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                {request.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => settleConfirm(true)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors",
                  request.danger
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-neutral-900 hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300",
                )}
              >
                {request.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </div>
    </Dialog>
  );
}
