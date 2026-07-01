import { CopyCheck as CopyCheckIcon, Copy as CopyIcon } from "lucide-react";
import { useState } from "react";
import { type CopyOptions, copyToClipboard } from "@/shared/lib/copy";
import { notify } from "@/shared/lib/notify";
import { ACTION_ICON_SIZE, actionButtonClassName } from "./actionButton";

type CopyButtonProps = CopyOptions & {
  className?: string;
  /** Render as a small labeled action button (icon + this text). */
  label?: string;
};

export const CopyButton = ({ text, markdown, html, className, label }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    try {
      if (event.altKey) {
        // Copy the best available content as plain text
        const content = markdown || html || text || "";
        await navigator.clipboard.writeText(content);
      } else {
        await copyToClipboard({ text, markdown, html });
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("failed to copy", error);
      notify.error("Couldn't copy", "Your browser blocked clipboard access.");
    }
  };

  const title = "Copy to clipboard (Alt+click for raw markdown)";

  if (label !== undefined) {
    return (
      <button onClick={handleCopy} className={actionButtonClassName} title={title} type="button">
        {copied ? <CopyCheckIcon size={ACTION_ICON_SIZE} /> : <CopyIcon size={ACTION_ICON_SIZE} />}
        <span>{copied ? "Copied" : label}</span>
      </button>
    );
  }

  const buttonClasses =
    "text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors opacity-60 hover:opacity-100 p-2 -m-1";

  return (
    <button onClick={handleCopy} className={buttonClasses} title={title} type="button">
      {copied ? <CopyCheckIcon className={className || "h-4 w-4"} /> : <CopyIcon className={className || "h-4 w-4"} />}
    </button>
  );
};
