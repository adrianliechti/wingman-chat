import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { parseMarkdown } from "@tanstack/markdown/parser";
import { ArrowUpRight, EyeOff, X } from "lucide-react";
import { useState } from "react";
import { getConfig, type ChatAnnouncementConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { Markdown } from "@/shared/ui/Markdown";

const DISMISSED_ANNOUNCEMENT_KEY = "app_dismissed_chat_announcement";
// Keep temporary dismissal across route remounts; a full reload resets it.
let dismissedUntilReload: string | null = null;

function announcementAction(action: ChatAnnouncementConfig["action"]) {
  const label = action?.label?.trim();
  if (!label || !action?.url?.trim()) return undefined;
  try {
    const url = new URL(action.url.trim());
    if (url.protocol === "https:" || url.protocol === "http:") return { label, url: url.href };
  } catch {
    // Hide actions without a valid web destination.
  }
  return undefined;
}

function readDismissedAnnouncement() {
  if (dismissedUntilReload !== null) return dismissedUntilReload;
  try {
    return localStorage.getItem(DISMISSED_ANNOUNCEMENT_KEY);
  } catch {
    return null;
  }
}

export function ChatAnnouncement() {
  const announcement = getConfig().chat?.announcement;
  const markdown = announcement?.text?.trim();
  const title = announcement?.title?.trim() || "A quick note";
  const action = announcementAction(announcement?.action);
  const announcementContent = JSON.stringify([title, markdown, ...(action ? [action.label, action.url] : [])]);
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState(readDismissedAnnouncement);
  if (!markdown || dismissedAnnouncement === announcementContent) return null;
  const twoColumn = parseMarkdown(markdown).children.some(
    (node) => node.type === "paragraph" && node.children.length === 1 && node.children[0].type === "image",
  );

  const close = () => {
    dismissedUntilReload = announcementContent;
    setDismissedAnnouncement(announcementContent);
  };
  const doNotShowAgain = () => {
    try {
      localStorage.setItem(DISMISSED_ANNOUNCEMENT_KEY, announcementContent);
    } catch {
      // The dialog can still be dismissed when browser storage is unavailable.
    }
    close();
  };

  return (
    <Dialog open onClose={close} className="relative z-80">
      <DialogBackdrop className="fixed inset-0 bg-black/20 backdrop-blur-[1px] dark:bg-black/40" />
      <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4 pt-[max(var(--safe-top),1rem)] pb-[max(var(--safe-bottom),1rem)]">
        <DialogPanel
          className={cn(
            "relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-3xl border border-neutral-200/80 bg-white text-neutral-900 shadow-2xl shadow-black/15 dark:border-neutral-700/70 dark:bg-neutral-900 dark:text-neutral-200",
            twoColumn ? "max-w-2xl" : "max-w-lg",
          )}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close announcement"
            className="absolute top-3 right-3 z-10 flex size-10 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <X size={20} aria-hidden="true" />
          </button>
          <div className="min-h-0 overflow-y-auto p-5 pt-10 pb-2 sm:p-7 sm:pt-8 sm:pb-2">
            <div className={cn(twoColumn && "md:grid md:grid-cols-[1.1fr_1fr] md:items-start md:gap-x-6")}>
              <DialogTitle
                className={cn(
                  "mb-3 shrink-0 font-semibold tracking-tight [overflow-wrap:anywhere]",
                  twoColumn ? "pr-6 text-[28px] leading-tight md:col-start-1 md:pr-0 md:text-3xl" : "text-xl leading-7",
                )}
              >
                {title}
              </DialogTitle>
              <div
                className={cn(
                  "min-h-0 min-w-0 overflow-y-auto text-sm leading-6 text-neutral-600 [overflow-wrap:anywhere] dark:text-neutral-400",
                  "[&_p]:my-4 [&_p]:leading-6 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
                  "[&_.font-semibold]:font-medium",
                  "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:tracking-normal",
                  "[&_ul]:my-3 [&_ul]:ml-0 [&_ul]:list-none [&_ul]:space-y-3 [&_ul]:p-0 [&_li]:py-0 [&_li]:leading-6",
                  "[&_a]:font-normal [&_a]:text-inherit [&_a]:decoration-1 [&_a]:decoration-neutral-400/70 dark:[&_a]:text-inherit dark:[&_a]:decoration-neutral-500",
                  "[&_a:hover]:text-neutral-950 [&_a:hover]:decoration-current dark:[&_a:hover]:text-white [&_a:focus-visible]:ring-neutral-400/50",
                  twoColumn && [
                    "md:contents [&_p]:my-3 [&_p]:text-sm [&_p]:leading-6 md:[&_p]:col-start-1 md:[&_ul]:col-start-1",
                    "[&_ul]:mt-4 [&_ul]:mb-0 [&_ul]:space-y-2 [&_li]:flex [&_li]:items-center [&_li]:gap-2.5 [&_li]:text-sm [&_li_p]:m-0 [&_li_p]:text-sm",
                    "[&_li_img]:my-0 [&_li_img]:inline-block [&_li_img]:size-7 [&_li_img]:shrink-0 [&_li_img]:rounded-full [&_li_img]:bg-neutral-100 [&_li_img]:p-1.5 dark:[&_li_img]:invert",
                    "[&_p:has(>img:only-child)]:my-3 [&_p:has(>img:only-child)]:flex [&_p:has(>img:only-child)]:justify-center md:[&_p:has(>img:only-child)]:col-start-2 md:[&_p:has(>img:only-child)]:row-start-1 md:[&_p:has(>img:only-child)]:row-span-3 md:[&_p:has(>img:only-child)]:my-0 md:[&_p:has(>img:only-child)]:self-center",
                    "[&_p>img:only-child]:my-0 [&_p>img:only-child]:max-h-24 [&_p>img:only-child]:w-full md:[&_p>img:only-child]:max-h-56 dark:[&_p>img:only-child]:mix-blend-lighten dark:[&_p>img:only-child]:invert",
                  ],
                )}
              >
                <Markdown compact>{markdown}</Markdown>
              </div>
            </div>
          </div>
          <div className={cn("flex shrink-0 px-5 pt-4 pb-5 sm:px-7", twoColumn ? "justify-center" : "justify-start")}>
            {action ? (
              <a
                href={action.url}
                target="_blank"
                rel="noopener noreferrer"
                data-autofocus
                onClick={close}
                className="flex min-h-11 w-full max-w-full items-center justify-center gap-2 rounded-full bg-neutral-900 px-6 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 sm:w-auto sm:min-w-48 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                {action.label}
                <ArrowUpRight size={16} className="shrink-0" aria-hidden="true" />
              </a>
            ) : (
              <button
                type="button"
                data-autofocus
                onClick={close}
                className="min-h-11 w-full min-w-20 shrink-0 rounded-full bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 sm:w-auto dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                Got it
              </button>
            )}
          </div>
          <div className="flex shrink-0 justify-end border-t border-neutral-100 bg-neutral-50/80 px-5 py-1 sm:px-7 dark:border-neutral-800 dark:bg-neutral-950/30">
            <button
              type="button"
              onClick={doNotShowAgain}
              className="-mr-2 flex min-h-10 max-w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-normal text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <EyeOff size={15} aria-hidden="true" />
              Do not show again
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
