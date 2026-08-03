import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Download, FileText, LifeBuoy, PencilRuler, Sunset, X } from "lucide-react";
import { Fragment, useCallback, useState } from "react";
import { getConfig } from "@/shared/config";
import { exportNotebooksAsZip } from "../lib/notebookImportExport";

const STORAGE_KEY = "notebook_sunset_dismissed";

/** Shutdown date, and the day the notice returns for anyone who dismissed it early. */
const SUNSET_DATE = "31 August";
const FINAL_REMINDER_FROM = "2026-08-24";

/**
 * Shows the notice once, then again in the final week for people who dismissed
 * it weeks ahead of the shutdown. The stored value is the stage that was seen.
 */
export function useSunsetNotice() {
  const stage = new Date().toISOString().slice(0, 10) >= FINAL_REMINDER_FROM ? "final" : "notice";
  const [open, setOpen] = useState(() => localStorage.getItem(STORAGE_KEY) !== stage);

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, stage);
    setOpen(false);
  }, [stage]);

  return { open, dismiss };
}

const MOVED: {
  icon: typeof FileText;
  title: string;
  description: string;
  recommended?: boolean;
}[] = [
  {
    icon: PencilRuler,
    title: "Studio",
    description: "Documents, slides, sheets, visuals & images — switch it on in the + menu of any chat.",
    recommended: true,
  },
  {
    icon: FileText,
    title: "Your sources",
    description: "Attach files, search the web, or add your corporate templates so results match your house style.",
  },
  {
    icon: Download,
    title: "Your existing notebooks",
    description: `Still here until ${SUNSET_DATE} — export anything you want to keep.`,
  },
];

interface NotebookSunsetNoticeProps {
  open: boolean;
  canExport: boolean;
  onDismiss: () => void;
}

export function NotebookSunsetNotice({ open, canExport, onDismiss }: NotebookSunsetNoticeProps) {
  const supportUrl = getConfig().support?.url;
  const navigate = useNavigate();

  return (
    <Transition show={open} as={Fragment}>
      <Dialog as="div" className="relative z-200" onClose={onDismiss}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-end sm:items-center justify-center sm:p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <DialogPanel className="w-full sm:max-w-lg bg-white/90 dark:bg-neutral-900/95 backdrop-blur-xl rounded-t-2xl sm:rounded-2xl shadow-2xl border border-neutral-200/80 dark:border-neutral-700/80 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-200/60 dark:border-neutral-800/60">
                  <div className="flex items-center gap-2.5">
                    <div className="shrink-0 w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                      <Sunset size={14} className="text-neutral-600 dark:text-neutral-400" />
                    </div>
                    <DialogTitle className="text-sm font-semibold leading-none text-neutral-900 dark:text-neutral-100">
                      Notebook is retiring
                    </DialogTitle>
                  </div>
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Body */}
                <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
                  <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
                    We are removing Notebook at the end of August. Everything it does now works in the normal chat, so
                    nothing goes away — it just moves to one place. Switch on Studio there for the best results.
                  </p>

                  <div className="space-y-2">
                    {MOVED.map((item) => (
                      <div
                        key={item.title}
                        className={`flex items-start gap-3 p-3 rounded-lg border backdrop-blur-sm ${
                          item.recommended
                            ? "border-blue-500/60 dark:border-blue-500/50 bg-blue-50/70 dark:bg-blue-950/30"
                            : "border-neutral-300/50 dark:border-neutral-700/50 bg-white/50 dark:bg-neutral-800/50"
                        }`}
                      >
                        <item.icon
                          size={13}
                          className={`mt-0.5 shrink-0 ${
                            item.recommended
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-neutral-500 dark:text-neutral-400"
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">{item.title}</p>
                            {item.recommended && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium leading-none bg-blue-500/15 dark:bg-blue-400/15 text-blue-700 dark:text-blue-300">
                                Recommended
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                            {item.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                    Our team is here to help — reach out any time if you want a hand moving your work across.
                  </p>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30">
                  <div className="flex items-center gap-1">
                    {canExport && (
                      <button
                        type="button"
                        onClick={() => void exportNotebooksAsZip()}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                      >
                        <Download size={12} />
                        Export all
                      </button>
                    )}
                    {supportUrl && (
                      <a
                        href={supportUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                      >
                        <LifeBuoy size={12} />
                        Get help
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onDismiss}
                      className="px-3.5 py-2 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    >
                      Not now
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onDismiss();
                        void navigate({ to: "/chat" });
                      }}
                      className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-700 dark:hover:bg-neutral-300 transition-colors"
                    >
                      Go to chat
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
