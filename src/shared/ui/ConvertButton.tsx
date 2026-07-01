import { FileDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { downloadBlob } from "@/shared/lib/utils";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "./DropdownMenu";

type ConvertButtonProps = {
  markdown: string;
  className?: string;
};

function generateFilename(extension: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const time = now.toTimeString().slice(0, 5).replace(":", "-"); // HH-MM
  return `message-${date}-${time}.${extension}`;
}

export const ConvertButton = ({ markdown, className }: ConvertButtonProps) => {
  const [isConverting, setIsConverting] = useState(false);

  const handleDownloadMarkdown = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, generateFilename("md"));
  };

  const handleDownloadWord = async () => {
    setIsConverting(true);
    try {
      const { markdownToDocx } = await import("@/shared/lib/markdownToDocx");
      const blob = await markdownToDocx(markdown);
      downloadBlob(blob, generateFilename("docx"));
    } catch (error) {
      console.error("Failed to convert to Word:", error);
    } finally {
      setIsConverting(false);
    }
  };

  const buttonClasses =
    "text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors opacity-60 hover:opacity-100 p-2 -m-1";

  return (
    <DropdownMenu
      anchor="top start"
      trigger={
        <MenuButton className={buttonClasses} title="Download message" disabled={isConverting}>
          {isConverting ? (
            <Loader2 className={`${className || "h-4 w-4"} animate-spin`} />
          ) : (
            <FileDown className={className || "h-4 w-4"} />
          )}
        </MenuButton>
      }
    >
      <DropdownMenuItem onClick={handleDownloadWord}>Word (.docx)</DropdownMenuItem>
      <DropdownMenuItem onClick={handleDownloadMarkdown}>Markdown (.md)</DropdownMenuItem>
    </DropdownMenu>
  );
};
