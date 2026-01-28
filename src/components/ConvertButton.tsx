import { useState } from 'react';
import { FileDown, Loader2 } from "lucide-react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { markdownToDocx } from "../lib/markdownToDocx";
import { downloadBlob } from "../lib/utils";

type ConvertButtonProps = {
  markdown: string;
  className?: string;
};

function generateFilename(extension: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const time = now.toTimeString().slice(0, 5).replace(':', '-'); // HH-MM
  return `message-${date}-${time}.${extension}`;
}

export const ConvertButton = ({ markdown, className }: ConvertButtonProps) => {
  const [isConverting, setIsConverting] = useState(false);

  const handleDownloadMarkdown = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, generateFilename('md'));
  };

  const handleDownloadWord = async () => {
    setIsConverting(true);
    try {
      const blob = await markdownToDocx(markdown);
      downloadBlob(blob, generateFilename('docx'));
    } catch (error) {
      console.error("Failed to convert to Word:", error);
    } finally {
      setIsConverting(false);
    }
  };

  const buttonClasses = "text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors opacity-60 hover:opacity-100 p-1";

  return (
    <Menu as="div" className="relative">
      <MenuButton
        className={buttonClasses}
        title="Download message"
        disabled={isConverting}
      >
        {isConverting ? (
          <Loader2 className={`${className || "h-4 w-4"} animate-spin`} />
        ) : (
          <FileDown className={className || "h-4 w-4"} />
        )}
      </MenuButton>
      <MenuItems
        modal={false}
        transition
        anchor="top start"
        className="z-50 mb-1 rounded-lg bg-neutral-50/95 dark:bg-neutral-800/95 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 shadow-lg overflow-hidden origin-bottom-left transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0"
      >
        <MenuItem>
          <button
            type="button"
            onClick={handleDownloadWord}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-700 transition-colors"
          >
            Word (.docx)
          </button>
        </MenuItem>
        <MenuItem>
          <button
            type="button"
            onClick={handleDownloadMarkdown}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-700 transition-colors"
          >
            Markdown (.md)
          </button>
        </MenuItem>
        
      </MenuItems>
    </Menu>
  );
};
