import { useState } from 'react';
import { Copy as CopyIcon, CopyCheck as CopyCheckIcon } from "lucide-react";
import { copyToClipboard, type CopyOptions } from "../lib/copy";

type CopyButtonProps = CopyOptions & {
  className?: string;
};

export const CopyButton = ({ text, markdown, html, className }: CopyButtonProps) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
        try {
            if (event.altKey) {
                // Copy the best available content as plain text
                const content = markdown || html || text || '';
                await navigator.clipboard.writeText(content);
            } else {
                await copyToClipboard({ text, markdown, html });
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error("failed to copy", error);
        }
    };

    const buttonClasses = "text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors opacity-60 hover:opacity-100 p-1";

    return (
        <button
            onClick={handleCopy}
            className={buttonClasses}
            title="Copy message to clipboard (Alt+click for raw markdown)"
            type="button"
        >
            {copied ? (
                <CopyCheckIcon className={className || "h-4 w-4"} />
            ) : (
                <CopyIcon className={className || "h-4 w-4"} />
            )}
        </button>
    );
};