import { ArrowUpRight } from "lucide-react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { useMemo } from "react";
import { getConfig } from "@/shared/config";
import { Markdown } from "@/shared/ui/Markdown";

export function ChatBanner() {
  const banner = useMemo(() => {
    try {
      return getConfig().banner ?? null;
    } catch {
      return null;
    }
  }, []);

  if (!banner) return null;

  return (
    <div className="pointer-events-auto mt-6 w-full px-1">
      <div className="flex items-center gap-3">
        {banner.icon && (
          <DynamicIcon
            name={banner.icon as IconName}
            size={16}
            className="shrink-0 text-neutral-500 dark:text-neutral-400"
          />
        )}
        <div className="flex-1 min-w-0 text-sm text-neutral-600 dark:text-neutral-400 [&_p]:m-0">
          <Markdown compact>{banner.message}</Markdown>
        </div>
        {banner.action && (
          <a
            href={banner.action.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300/70 px-3.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-600/60 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            {banner.action.label}
            <ArrowUpRight size={12} />
          </a>
        )}
      </div>
    </div>
  );
}
