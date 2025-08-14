import { Share2 as ShareIcon } from "lucide-react";
import { Button } from "@headlessui/react";
import { share } from "../lib/share";

type ShareButtonProps = {
  text: string;
  className?: string;
};

export const ShareButton = ({ text, className }: ShareButtonProps) => {
    const handleShare = async () => {
        await share(undefined, text);
    };

    const buttonClasses = "text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors opacity-60 hover:opacity-100 p-1";

    return (
        <Button
            onClick={handleShare}
            className={buttonClasses}
            title="Share message"
        >
            <ShareIcon className={className || "h-4 w-4"} />
        </Button>
    );
};
