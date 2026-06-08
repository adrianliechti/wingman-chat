import { Check, Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Model } from "@/shared/types/chat";

interface ModelDropdownProps {
  models: Model[];
  value: string;
  onChange: (modelId: string) => void;
  includeRealtime?: boolean;
  dropdownClassName?: string;
  trigger: (props: { onClick: () => void; onPointerDownCapture: (e: React.PointerEvent) => void }) => React.ReactNode;
}

function ModelOption({
  id,
  name,
  description,
  selected,
  icon,
  onSelect,
}: {
  id: string;
  name: string;
  description?: string;
  selected: boolean;
  icon?: React.ReactNode;
  onSelect: (modelId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      title={description}
      className={`group flex w-full items-start gap-2 px-3 py-2 rounded-lg text-left transition-colors hover:bg-neutral-100/60 dark:hover:bg-white/5 ${
        selected ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-800 dark:text-neutral-200"
      }`}
    >
      {icon && <span className="shrink-0 mt-0.5 flex justify-center text-neutral-400">{icon}</span>}
      <span className="flex flex-col items-start flex-1 min-w-0">
        <span className={`text-sm leading-tight ${selected ? "font-semibold" : "font-normal"}`}>{name}</span>
        {description && (
          <span className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 leading-snug opacity-90">
            {description}
          </span>
        )}
      </span>
      <Check
        size={14}
        className={`shrink-0 mt-0.5 text-neutral-500 dark:text-neutral-400 ${selected ? "opacity-100" : "opacity-0"}`}
      />
    </button>
  );
}

export function ModelDropdown({
  models,
  value,
  onChange,
  includeRealtime = false,
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
      setOpenUpward(spaceBelow < 256 && rect.top > spaceBelow);
    }
    setIsOpen((prev) => !prev);
  };

  const renderModelItem = (m: Model) => (
    <ModelOption
      key={m.id}
      id={m.id}
      name={m.name ?? m.id}
      description={m.description}
      selected={m.id === value}
      onSelect={handleSelect}
    />
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
              <ModelOption
                id="realtime"
                name="Real-time Voice"
                selected={value === "realtime"}
                icon={<Mic size={13} className="shrink-0" />}
                onSelect={handleSelect}
              />
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
