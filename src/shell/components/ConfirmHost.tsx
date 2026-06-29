import { Dialog, Transition } from "@headlessui/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { type ConfirmOptions, getConfirmRequest, settleConfirm, subscribeConfirm } from "@/shared/lib/confirm";

// Renders the app's single confirm dialog, driven by the `confirm()` store.
export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  useEffect(() => subscribeConfirm(() => setRequest(getConfirmRequest())), []);

  // Hold the last request so content stays visible during the close transition.
  const lastRef = useRef<ConfirmOptions | null>(null);
  if (request) lastRef.current = request;
  const data = request ?? lastRef.current;

  return (
    <Transition appear show={!!request} as={Fragment}>
      <Dialog as="div" className="relative z-200" onClose={() => settleConfirm(false)}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40 dark:bg-black/60" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl transition-all">
                <div className="px-6 pt-5 pb-4">
                  <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                    {data?.title}
                  </Dialog.Title>
                  {data?.message && (
                    <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                      {data.message}
                    </p>
                  )}
                </div>
                <div className="flex justify-end gap-2 px-6 py-4 bg-neutral-50/60 dark:bg-neutral-900/40 border-t border-neutral-200 dark:border-neutral-800">
                  <button
                    type="button"
                    onClick={() => settleConfirm(false)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    {data?.cancelLabel ?? "Cancel"}
                  </button>
                  <button
                    type="button"
                    // biome-ignore lint/a11y/noAutofocus: focusing the action in a modal confirm is expected
                    autoFocus
                    onClick={() => settleConfirm(true)}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors",
                      data?.danger
                        ? "bg-red-600 hover:bg-red-700"
                        : "bg-neutral-900 hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300",
                    )}
                  >
                    {data?.confirmLabel ?? "Confirm"}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
