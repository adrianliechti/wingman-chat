import { useState } from 'react';
import { Download as DownloadIcon, Check as CheckIcon } from "lucide-react";

type DownloadButtonProps = {
  url: string;
  filename?: string;
  className?: string;
};

export const DownloadButton = ({ url, filename, className }: DownloadButtonProps) => {
    const [downloaded, setDownloaded] = useState(false);

    const handleDownload = async () => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const downloadUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = filename || 'download';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(downloadUrl);
            
            setDownloaded(true);
            setTimeout(() => setDownloaded(false), 2000);
        } catch (error) {
            console.error("failed to download", error);
        }
    };

    const buttonClasses = "text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors opacity-60 hover:opacity-100 p-1";

    return (
        <button
            onClick={handleDownload}
            className={buttonClasses}
            title="Download file"
            type="button"
        >
            {downloaded ? (
                <CheckIcon className={className || "h-4 w-4"} />
            ) : (
                <DownloadIcon className={className || "h-4 w-4"} />
            )}
        </button>
    );
};
