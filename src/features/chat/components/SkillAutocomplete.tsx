import { autoUpdate, flip, FloatingPortal, offset, shift, size, useFloating } from "@floating-ui/react";
import { Sparkles, X } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import type { useSkillAutocomplete } from "../hooks/useSkillAutocomplete";
import { cn } from "@/shared/lib/cn";

type Completion = ReturnType<typeof useSkillAutocomplete>;

export function SelectedSkills({
  names,
  onRemove,
  disabled = false,
}: {
  names: string[];
  onRemove: (name: string) => void;
  disabled?: boolean;
}) {
  if (!names.length) return null;
  return (
    <div aria-label="Selected skills" className="flex flex-wrap gap-2 px-3 pt-3 md:px-4">
      {names.map((name) => (
        <span
          key={name}
          title={`Skill: ${name}`}
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-100/70 py-1 pl-2 pr-1 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800/70 dark:text-neutral-300"
        >
          <Sparkles size={13} className="shrink-0" />
          <span className="truncate">{name}</span>
          <button
            type="button"
            aria-label={`Remove skill ${name}`}
            disabled={disabled}
            onClick={() => onRemove(name)}
            className="shrink-0 rounded p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700"
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

export function SkillAutocomplete({
  completion,
  input,
}: {
  completion: Completion;
  input: RefObject<HTMLTextAreaElement | null>;
}) {
  const { refs, floatingStyles } = useFloating({
    open: completion.open,
    placement: "top-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(0, Math.min(340, availableHeight))}px`;
        },
      }),
    ],
  });
  const setReference = refs.setReference;
  useEffect(() => {
    if (completion.open) setReference(input.current);
  }, [completion.open, setReference, input]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (completion.open) listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [completion.activeIndex, completion.open]);
  if (!completion.open) return null;
  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="z-60 flex w-96 max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-neutral-200/80 bg-white/95 shadow-xl backdrop-blur-xl dark:border-neutral-700 dark:bg-neutral-900/95"
      >
        <div className="flex items-center justify-between px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="font-medium">Skills</span>
          <span aria-hidden="true">↑↓ navigate · Enter to add</span>
        </div>
        <div
          ref={listRef}
          id={completion.listId}
          role="listbox"
          aria-label="Skill suggestions"
          className="min-h-0 overflow-y-auto px-1 pb-1"
        >
          {completion.options.map((option, index) => (
            <button
              key={option.name}
              id={`${completion.listId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === completion.activeIndex}
              tabIndex={-1}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => completion.choose(option)}
              onPointerMove={() => completion.setActive(index)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left",
                index === completion.activeIndex
                  ? "bg-neutral-100 dark:bg-neutral-800"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60",
              )}
            >
              <Sparkles size={16} className="mt-0.5 shrink-0 text-neutral-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                  {option.name}
                </span>
                <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {option.description}
                </span>
              </span>
            </button>
          ))}
          {completion.options.length === 0 && (
            <p role="status" className="px-3 py-4 text-sm text-neutral-500">
              {completion.trigger?.query ? "No matching skills" : "No personal or plugin skills available"}
            </p>
          )}
        </div>
        <span className="sr-only" aria-live="polite">
          {completion.options.length} suggestions
        </span>
      </div>
    </FloatingPortal>
  );
}
