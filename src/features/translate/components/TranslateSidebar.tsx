import {
  AlertCircle,
  Languages,
  Loader2,
  MoreVertical,
  PanelRightOpen,
  PlusIcon,
  Trash,
  TextCursorInput,
} from "lucide-react";
import { useMemo } from "react";
import { useTranslate } from "../hooks/useTranslate";
import { languageName } from "../lib/languages";
import { translationTitle } from "../lib/translationStorage";
import type { Translation } from "../types/translate";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import { formatRelativeTime } from "@/shared/lib/formatRelativeTime";
import { notify } from "@/shared/lib/notify";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { FileIcon } from "@/shared/ui/FileIcon";
import { useSidebar } from "@/shell/hooks/useSidebar";

const SECTIONS = ["Today", "Yesterday", "This Week", "Last Week", "Last Month", "Older"] as const;

function sectionOf(date: Date, now: Date): (typeof SECTIONS)[number] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((today - day) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This Week";
  if (days < 14) return "Last Week";
  if (days < 30) return "Last Month";
  return "Older";
}

function groupByDate(translations: Translation[]): { section: string; items: Translation[] }[] {
  const now = new Date();
  const groups = new Map<string, Translation[]>();
  for (const translation of translations) {
    const section = sectionOf(translation.updated, now);
    groups.set(section, [...(groups.get(section) ?? []), translation]);
  }
  return SECTIONS.flatMap((section) => {
    const items = groups.get(section);
    return items ? [{ section, items }] : [];
  });
}

/** Saved translations, newest first, grouped by day like the chat list. */
export function TranslateSidebar() {
  const { translations, active, open, newTranslation, remove, isLoaded } = useTranslate();
  const { setShowSidebar } = useSidebar();

  const groups = useMemo(
    () => groupByDate([...translations].sort((a, b) => b.updated.getTime() - a.updated.getTime())),
    [translations],
  );

  const closeOnMobile = () => {
    if (window.innerWidth < 768) setShowSidebar(false);
  };

  const deleteTranslation = async (translation: Translation) => {
    const confirmed = await confirm({
      title: "Delete this translation?",
      message: translationTitle(translation),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await remove(translation.id);
    } catch (error) {
      notify.error("Couldn't delete the translation", error);
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-neutral-200 px-2 py-2 md:h-[3.6875rem] md:px-1.5 md:py-1 dark:border-neutral-800">
        <span className="px-2 text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">
          Translations
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-1">
          <button
            type="button"
            onClick={() => {
              newTranslation();
              closeOnMobile();
            }}
            className="rounded p-2 text-neutral-600 transition-all duration-200 hover:bg-neutral-200/60 hover:text-neutral-800 md:p-1.5 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            aria-label="New translation"
            title="New translation"
          >
            <PlusIcon size={20} />
          </button>
          <button
            type="button"
            onClick={() => setShowSidebar(false)}
            className="rounded p-2 text-neutral-600 transition-all duration-200 hover:bg-neutral-200/60 hover:text-neutral-800 md:p-1.5 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            aria-label="Close sidebar"
          >
            <PanelRightOpen size={20} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 md:px-1.5">
        {isLoaded && translations.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 pt-16 text-center">
            <Languages size={22} className="text-neutral-300 dark:text-neutral-600" />
            <p className="text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
              Texts and documents you translate are kept here.
            </p>
          </div>
        )}
        {groups.map((group) => (
          <section key={group.section} className="pt-2">
            <h3 className="py-1 pl-3 text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
              {group.section}
            </h3>
            <ul>
              {group.items.map((translation) => {
                const title = translationTitle(translation);
                const isActive = translation.id === active?.id;
                return (
                  <li
                    key={translation.id}
                    className={cn(
                      "group relative flex shrink-0 cursor-pointer items-center rounded-lg py-2 pr-1 pl-2.5 transition-colors duration-200 md:py-1.5 md:pr-0.5",
                      isActive
                        ? "bg-neutral-200/70 text-neutral-900 dark:bg-white/10 dark:text-neutral-100"
                        : "hover:bg-neutral-200/40 dark:hover:bg-white/5",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        open(translation.id);
                        closeOnMobile();
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 pr-8 text-left"
                      title={title}
                      aria-current={isActive || undefined}
                    >
                      <span className="shrink-0">
                        {translation.kind === "file" && translation.sourceFile ? (
                          <FileIcon
                            name={translation.sourceFile.name}
                            contentType={translation.sourceFile.contentType}
                            size={16}
                          />
                        ) : (
                          <TextCursorInput size={16} className="text-neutral-500 dark:text-neutral-400" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-base md:text-sm",
                            isActive ? "font-medium" : "text-neutral-700 dark:text-neutral-300",
                          )}
                        >
                          {title}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                          {translation.status === "running" && (
                            <Loader2 size={11} className="shrink-0 animate-spin" aria-label="Translating" />
                          )}
                          {translation.status === "error" && (
                            <AlertCircle size={11} className="shrink-0 text-red-500" aria-label="Failed" />
                          )}
                          <span className="truncate">
                            {languageName(translation.targetLang)} · {formatRelativeTime(translation.updated)}
                          </span>
                        </span>
                      </span>
                    </button>
                    <DropdownMenu
                      anchor="bottom end"
                      trigger={
                        <MenuButton
                          aria-label={`Options for ${title}`}
                          className="absolute top-2 right-1.5 shrink-0 -m-1 rounded p-2 text-neutral-600 opacity-100 transition-opacity duration-200 hover:bg-neutral-200/60 hover:text-neutral-800 md:top-1.5 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-200"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <MoreVertical size={16} />
                        </MenuButton>
                      }
                    >
                      <DropdownMenuItem
                        icon={<Trash size={14} />}
                        destructive
                        onClick={() => void deleteTranslation(translation)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
