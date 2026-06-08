import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Model } from "@/shared/types/chat";

interface ModelDropdownProps {
  /** All available models (already filtered/loaded by the caller). */
  models: Model[];
  /** Currently selected model id. */
  value: string;
  /** Called when the user picks a model. */
  onChange: (modelId: string) => void;
  /** When true a "Real-time Voice" option is shown at the top of the list. */
  includeRealtime?: boolean;
  /**
   * Optional custom renderer for each model item. Receives the model and a
   * pre-built `onSelect` callback. Defaults to a plain text button.
   */
  renderItem?: (model: Model, onSelect: (modelId: string) => void) => React.ReactNode;
  /** Extra classes applied to the dropdown panel. Use to override width, etc. */
  dropdownClassName?: string;
  /**
   * Render prop that receives the trigger props to spread onto the trigger element.
   */
  trigger: (props: { onClick: () => void; onPointerDownCapture: (e: React.PointerEvent) => void }) => React.ReactNode;
}

/**
 * Shared model picker dropdown used by the agent drawer, wizard review step,
 * and chat input. Callers keep their own trigger appearance via the `trigger`
 * render prop; this component owns all list/filter/alt-click/click-outside logic.
 */
export function ModelDropdown({
  models,
  value,
  onChange,
  includeRealtime = false,
  renderItem,
  dropdownClassName,
  trigger,
}: ModelDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showHiddenModels, setShowHiddenModels] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleModels = models.filter((m) => m.id !== "realtime" && !m.hidden);
  const hiddenModels = models.filter((m) => m.id !== "realtime" && m.hidden);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowHiddenModels(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setIsOpen(false);
    setShowHiddenModels(false);
  };

  const toggleOpen = () => {
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // 256px = max-h-64
      setOpenUpward(spaceBelow < 256 && rect.top > spaceBelow);
    }
    setIsOpen((prev) => !prev);
  };

  const defaultItemClass = (id: string) =>
    `w-full text-left px-3 py-2 rounded-lg text-sm transition-colors hover:bg-neutral-100/60 dark:hover:bg-white/5 flex items-center gap-2 ${
      id === value
        ? "font-semibold text-neutral-900 dark:text-neutral-100"
        : "font-normal text-neutral-800 dark:text-neutral-200"
    }`;

  const renderModelItem = (m: Model) =>
    renderItem ? (
      renderItem(m, handleSelect)
    ) : (
      <button key={m.id} type="button" onClick={() => handleSelect(m.id)} className={defaultItemClass(m.id)}>
        {m.name ?? m.id}
      </button>
    );

  return (
    <div className="relative" ref={containerRef}>
      {trigger({
        onClick: toggleOpen,
        onPointerDownCapture: (e: React.PointerEvent) => {
          flushSync(() => setShowHiddenModels(e.altKey));
        },
      })}

      {isOpen && (
        <div
          className={`absolute z-20 max-h-64 overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-700/60 bg-white dark:bg-neutral-900 shadow-lg shadow-black/20 dark:shadow-black/50 p-1 ${openUpward ? "bottom-full mb-1" : "top-full mt-1"} ${dropdownClassName ?? "w-full"}`}
        >
          {includeRealtime && (
            <>
              <button type="button" onClick={() => handleSelect("realtime")} className={defaultItemClass("realtime")}>
                <Mic size={13} className="shrink-0 text-neutral-400" />
                Real-time Voice
              </button>
              {visibleModels.length > 0 && (
                <div className="mx-1 my-1 border-t border-neutral-200 dark:border-neutral-700" />
              )}
            </>
          )}

          {visibleModels.map((m) => renderModelItem(m))}

          {showHiddenModels && hiddenModels.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 border-y border-neutral-200 dark:border-neutral-700">
                Hidden
              </div>
              {hiddenModels.map((m) => renderModelItem(m))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
