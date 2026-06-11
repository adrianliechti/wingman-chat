import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Check, Mic } from "lucide-react";
import { Fragment, useRef } from "react";
import { flushSync } from "react-dom";
import type { Model } from "@/shared/types/chat";
import { PANEL_CLASS } from "./menuStyles";

interface ModelDropdownProps {
  models: Model[];
  value: string;
  onChange: (modelId: string) => void;
  includeRealtime?: boolean;
  dropdownClassName?: string;
  trigger: (props: { onClick: () => void; onPointerDownCapture: (e: React.PointerEvent) => void }) => React.ReactNode;
}

// ─── Single model row ─────────────────────────────────────────────────────────

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
    <MenuItem>
      <button
        type="button"
        onClick={() => onSelect(id)}
        title={description}
        className={`group flex w-full items-start gap-2 px-3 py-2 rounded-lg text-left transition-colors data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 ${
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
    </MenuItem>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function ModelDropdown({
  models,
  value,
  onChange,
  includeRealtime = false,
  dropdownClassName,
  trigger,
}: ModelDropdownProps) {
  const showHiddenRef = useRef(false);

  const visibleModels = models.filter((m) => m.id !== "realtime" && !m.hidden);
  const hiddenModels = models.filter((m) => m.id !== "realtime" && m.hidden);

  return (
    <Menu>
      {({ close }) => (
        <>
          <MenuButton as={Fragment}>
            {trigger({
              onClick: () => {
                /* MenuButton click is handled by HU via the Fragment wrapper */
              },
              onPointerDownCapture: (e: React.PointerEvent) => {
                flushSync(() => {
                  showHiddenRef.current = e.altKey;
                });
              },
            })}
          </MenuButton>

          <MenuItems
            modal={false}
            transition
            anchor="bottom start"
            className={[PANEL_CLASS, dropdownClassName].filter(Boolean).join(" ")}
          >
            {includeRealtime && (
              <>
                <ModelOption
                  id="realtime"
                  name="Real-time Voice"
                  selected={value === "realtime"}
                  icon={<Mic size={13} className="shrink-0" />}
                  onSelect={(id) => {
                    onChange(id);
                    close();
                  }}
                />
                {visibleModels.length > 0 && <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />}
              </>
            )}

            {visibleModels.map((m) => (
              <ModelOption
                key={m.id}
                id={m.id}
                name={m.name ?? m.id}
                description={m.description}
                selected={m.id === value}
                onSelect={(id) => {
                  onChange(id);
                  close();
                }}
              />
            ))}

            {showHiddenRef.current && hiddenModels.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 border-y border-neutral-200/60 dark:border-white/10">
                  Hidden
                </div>
                {hiddenModels.map((m) => (
                  <ModelOption
                    key={m.id}
                    id={m.id}
                    name={m.name ?? m.id}
                    description={m.description}
                    selected={m.id === value}
                    onSelect={(id) => {
                      onChange(id);
                      close();
                    }}
                  />
                ))}
              </>
            )}
          </MenuItems>
        </>
      )}
    </Menu>
  );
}
