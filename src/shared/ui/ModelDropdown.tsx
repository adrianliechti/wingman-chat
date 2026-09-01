import {
  autoUpdate,
  FloatingFocusManager,
  FloatingNode,
  FloatingPortal,
  FloatingTree,
  flip,
  offset,
  safePolygon,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useFloatingNodeId,
  useFloatingParentNodeId,
  useFloatingTree,
  useHover,
  useInteractions,
  useRole,
  useTransitionStyles,
} from "@floating-ui/react";
import { Check, ChevronRight, Gauge, Mic, Search } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/shared/lib/cn";
import type { Model } from "@/shared/types/chat";

// Show the filter box once the visible list is long enough to be unwieldy.
const SEARCH_THRESHOLD = 8;

const PANEL_CLASS =
  "rounded-xl border border-white/40 dark:border-neutral-700/60 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-lg shadow-black/20 dark:shadow-black/50 p-1";

type Effort = NonNullable<Model["effort"]>;

// One name per API level — `xhigh` and `max` are distinct tiers, so they must
// not share a label. Names follow the vendor consoles (…/Extra/Max).
const EFFORT_LABEL: Record<Effort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
  max: "Max",
};

const EFFORT_HINT = "Higher effort means more thorough responses, but takes longer and costs more.";

interface EffortConfig {
  /** Levels the model offers, ordered low to high as shown. */
  options: Effort[];
  /** Current selection, or null when nothing has been chosen for this chat. */
  value: Effort | null;
  /** Level to badge "Default" — what an unset chat reasons at. */
  defaultValue?: Effort;
  onChange: (effort: Effort) => void;
}

export interface SubmenuOption {
  value: string;
  /** Primary row text and the badge shown on the collapsed trigger. */
  label: string;
  /** Optional secondary line. */
  description?: string;
  /** Small pill after the label, e.g. "Default". */
  badge?: string;
}

/** A flyout submenu of single-select options, shown below the model list. */
export interface SubmenuConfig {
  icon?: React.ReactNode;
  /** Trigger row label, e.g. "Aspect". */
  label: string;
  /** Explanatory line above the options. */
  hint?: string;
  options: SubmenuOption[];
  /** Current selection, or null for the default. */
  value: string | null;
  /** Pass null to clear back to the default. */
  onChange: (value: string | null) => void;
  /**
   * Reset row that clears the selection. Omit for menus where every level is
   * explicit and one of them is badged as the default instead.
   */
  defaultLabel?: string;
  defaultDescription?: string;
}

interface ModelDropdownProps {
  models: Model[];
  value: string;
  onChange: (modelId: string) => void;
  includeRealtime?: boolean;
  dropdownClassName?: string;
  /** When set, renders a reasoning-effort submenu at the bottom of the model list. */
  effort?: EffortConfig;
  /** Extra single-select flyout submenus, rendered below the model list (after effort). */
  submenus?: SubmenuConfig[];
  /**
   * Renders the trigger element. Spread `getProps()` (which includes the
   * reference `ref` and open/keyboard handlers) onto the interactive element.
   * `altKey` is true when the trigger was activated with Option/Alt held, which
   * reveals hidden models.
   */
  trigger: (args: {
    getProps: (overrides?: React.HTMLProps<HTMLElement>) => Record<string, unknown>;
  }) => React.ReactNode;
}

// ─── Selectable row ───────────────────────────────────────────────────────────

function OptionRow({
  name,
  caption,
  description,
  badge,
  selected,
  icon,
  onSelect,
}: {
  name: string;
  caption?: string;
  description?: string;
  badge?: string;
  selected: boolean;
  icon?: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-start gap-2 px-3 py-2 rounded-lg text-left transition-colors focus:outline-none",
        selected
          ? "bg-neutral-100/70 text-neutral-900 dark:bg-white/10 dark:text-neutral-100"
          : "text-neutral-800 hover:bg-neutral-100/60 focus:bg-neutral-100/60 dark:text-neutral-200 dark:hover:bg-white/5 dark:focus:bg-white/5",
      )}
    >
      {icon && <span className="shrink-0 mt-0.5 flex justify-center text-neutral-400">{icon}</span>}
      <span className="flex flex-col items-start flex-1 min-w-0">
        <span className="flex w-full items-baseline gap-1.5 min-w-0">
          <span
            className={cn(
              "truncate text-[13px] leading-tight",
              selected ? "font-semibold" : "font-medium",
            )}
          >
            {name}
          </span>
          {caption && (
            <span className="truncate text-[11px] font-normal leading-tight text-neutral-500 dark:text-neutral-400">
              {caption}
            </span>
          )}
          {badge && (
            <span className="shrink-0 rounded px-1 py-px text-[10px] font-medium leading-none text-neutral-600 bg-neutral-200/70 dark:text-neutral-300 dark:bg-white/10">
              {badge}
            </span>
          )}
        </span>
        {description && (
          <span className="mt-0.5 truncate text-xs leading-snug text-neutral-500 dark:text-neutral-400">
            {description}
          </span>
        )}
      </span>
      <Check
        size={14}
        className={cn(
          "shrink-0 mt-0.5 text-neutral-500 dark:text-neutral-400",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
    </button>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
      {children}
    </div>
  );
}

// ─── Tree-aware close ─────────────────────────────────────────────────────────
// The dropdown and its effort flyout share one FloatingTree so the root's
// useDismiss treats a click inside the (portaled) submenu as "inside". Selecting
// anything emits a tree "click" that collapses the whole stack.

const TreeCloseContext = createContext<() => void>(() => {});

// ─── Flyout submenu ───────────────────────────────────────────────────────────

function OptionSubmenu({
  icon,
  label,
  hint,
  options,
  value,
  onChange,
  defaultLabel,
  defaultDescription,
}: SubmenuConfig) {
  const closeAll = useContext(TreeCloseContext);

  const [isOpen, setIsOpen] = useState(false);

  const tree = useFloatingTree();
  const nodeId = useFloatingNodeId();
  const parentId = useFloatingParentNodeId();

  const { refs, floatingStyles, context } = useFloating({
    nodeId,
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "right-start",
    middleware: [
      offset(4),
      flip({ fallbackPlacements: ["right-end", "left-start", "left-end"] }),
      shift({ padding: 8 }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, { handleClose: safePolygon(), delay: { close: 150 } });
  const click = useClick(context, { event: "mousedown", toggle: false, ignoreMouse: true });
  const dismiss = useDismiss(context, { bubbles: true });
  const role = useRole(context, { role: "menu" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, click, dismiss, role]);

  // Collapse when a sibling submenu opens so only one flyout is open at a time.
  useEffect(() => {
    if (!tree) return;
    const onSiblingOpen = (event: { nodeId: string; parentId: string | null }) => {
      if (event.nodeId !== nodeId && event.parentId === parentId) setIsOpen(false);
    };
    tree.events.on("menuopen", onSiblingOpen);
    return () => tree.events.off("menuopen", onSiblingOpen);
  }, [tree, nodeId, parentId]);
  useEffect(() => {
    if (isOpen && tree) tree.events.emit("menuopen", { nodeId, parentId });
  }, [tree, isOpen, nodeId, parentId]);

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <FloatingNode id={nodeId}>
      <button
        ref={refs.setReference}
        type="button"
        data-open={isOpen ? "" : undefined}
        className="group flex w-full items-center gap-2 px-3 py-2 rounded-lg text-left text-sm text-neutral-800 dark:text-neutral-200 transition-colors hover:bg-neutral-100/60 focus:bg-neutral-100/60 focus:outline-none data-open:bg-neutral-100/60 dark:hover:bg-white/5 dark:focus:bg-white/5 dark:data-open:bg-white/5"
        {...getReferenceProps()}
      >
        {icon && <span className="shrink-0 flex justify-center text-neutral-400">{icon}</span>}
        <span className="flex-1 min-w-0">{label}</span>
        {selectedLabel && (
          <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
            {selectedLabel}
          </span>
        )}
        <ChevronRight size={14} className="shrink-0 text-neutral-400" />
      </button>
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-9999"
            {...getFloatingProps()}
          >
            <div className={cn(PANEL_CLASS, "w-auto min-w-44 max-w-64")}>
              {hint && (
                <p className="px-3 pt-1.5 pb-2 text-xs leading-snug text-neutral-500 dark:text-neutral-400">
                  {hint}
                </p>
              )}
              {defaultLabel && (
                <>
                  <OptionRow
                    name={defaultLabel}
                    description={defaultDescription}
                    selected={value === null}
                    onSelect={() => {
                      onChange(null);
                      closeAll();
                    }}
                  />
                  <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />
                </>
              )}
              {options.map((opt) => (
                <OptionRow
                  key={opt.value}
                  name={opt.label}
                  description={opt.description}
                  badge={opt.badge}
                  selected={opt.value === value}
                  onSelect={() => {
                    onChange(opt.value);
                    closeAll();
                  }}
                />
              ))}
            </div>
          </div>
        </FloatingPortal>
      )}
    </FloatingNode>
  );
}

// ─── Root panel ───────────────────────────────────────────────────────────────

function ModelDropdownRoot({
  models,
  value,
  onChange,
  includeRealtime,
  dropdownClassName,
  effort,
  submenus,
  trigger,
}: ModelDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const showHiddenRef = useRef(false);

  const tree = useFloatingTree();
  const nodeId = useFloatingNodeId();

  const { refs, floatingStyles, context } = useFloating({
    nodeId,
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "bottom-start",
    middleware: [
      offset(8),
      flip({ fallbackPlacements: ["top-start"] }),
      shift({ padding: 8 }),
      size({
        apply({ availableHeight, elements }) {
          // Cap the panel so a long model list scrolls instead of stretching tall.
          elements.floating.style.setProperty(
            "--panel-max-h",
            `${Math.min(availableHeight, 384)}px`,
          );
        },
        padding: 8,
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const role = useRole(context, { role: "menu" });
  const dismiss = useDismiss(context, { bubbles: { escapeKey: false, outsidePress: true } });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, role, dismiss]);

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 100,
    initial: { opacity: 0, transform: "scale(0.95)" },
  });

  // Any leaf selection emits a tree "click" to close the whole stack.
  useEffect(() => {
    if (!tree) return;
    const close = () => setIsOpen(false);
    tree.events.on("click", close);
    return () => tree.events.off("click", close);
  }, [tree]);
  const closeAll = useCallback(() => tree?.events.emit("click"), [tree]);

  const visibleModels = models.filter((m) => m.id !== "realtime" && !m.hidden);
  const hiddenModels = models.filter((m) => m.id !== "realtime" && m.hidden);
  const showSearch = visibleModels.length > SEARCH_THRESHOLD;

  const q = query.trim().toLowerCase();
  const matches = (m: Model) =>
    !q ||
    (m.name ?? m.id).toLowerCase().includes(q) ||
    m.id.toLowerCase().includes(q) ||
    (m.description ?? "").toLowerCase().includes(q);
  const filteredVisible = q ? visibleModels.filter(matches) : visibleModels;
  const filteredHidden = q ? hiddenModels.filter(matches) : hiddenModels;

  const select = (id: string) => {
    onChange(id);
    closeAll();
  };

  const renderModel = (m: Model) => (
    <OptionRow
      key={m.id}
      name={m.name ?? m.id}
      caption={m.caption}
      description={m.description}
      selected={m.id === value}
      onSelect={() => select(m.id)}
    />
  );

  // Effort is just a submenu with model-specific labels; flatten it in with any
  // caller-provided submenus so they render uniformly below the model list.
  // Every level is explicit here — an unset chat shows the default level checked
  // and badged, rather than offering a separate "let the model decide" row that
  // would send no effort at all.
  const allSubmenus: SubmenuConfig[] = [
    ...(effort && effort.options.length > 0
      ? [
          {
            icon: <Gauge size={14} />,
            label: "Effort",
            hint: EFFORT_HINT,
            options: effort.options.map((o) => ({
              value: o,
              label: EFFORT_LABEL[o],
              badge: o === effort.defaultValue ? "Default" : undefined,
            })),
            value: effort.value ?? effort.defaultValue ?? null,
            onChange: (v: string | null) => {
              if (v) effort.onChange(v as Effort);
            },
          },
        ]
      : []),
    ...(submenus ?? []),
  ];

  return (
    <FloatingNode id={nodeId}>
      {trigger({
        getProps: (overrides) =>
          getReferenceProps({
            ref: refs.setReference,
            ...overrides,
            onPointerDownCapture: (e: React.PointerEvent) => {
              flushSync(() => {
                showHiddenRef.current = e.altKey;
                setQuery("");
              });
              (overrides?.onPointerDownCapture as ((e: React.PointerEvent) => void) | undefined)?.(
                e,
              );
            },
          }),
      })}

      <TreeCloseContext.Provider value={closeAll}>
        {isMounted && (
          <FloatingPortal>
            <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
              <div
                ref={refs.setFloating}
                style={floatingStyles}
                className="z-9999"
                {...getFloatingProps()}
              >
                <div
                  style={transitionStyles}
                  className={cn(PANEL_CLASS, "flex flex-col overflow-hidden", dropdownClassName)}
                >
                  <div
                    className="flex flex-col overflow-hidden"
                    style={{ maxHeight: "var(--panel-max-h, 24rem)" }}
                  >
                    {showSearch && (
                      <div className="mb-1 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-neutral-100/70 dark:bg-white/5">
                        <Search size={13} className="shrink-0 text-neutral-400" />
                        <input
                          type="text"
                          ref={(el) => {
                            if (el) requestAnimationFrame(() => el.focus());
                          }}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search models…"
                          aria-label="Search models"
                          className="w-full bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 focus:outline-none"
                        />
                      </div>
                    )}

                    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                      {includeRealtime && !q && (
                        <>
                          <OptionRow
                            name="Real-time Voice"
                            icon={<Mic size={13} className="shrink-0" />}
                            selected={value === "realtime"}
                            onSelect={() => select("realtime")}
                          />
                          {filteredVisible.length > 0 && (
                            <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />
                          )}
                        </>
                      )}

                      {filteredVisible.map(renderModel)}

                      {showHiddenRef.current && filteredHidden.length > 0 && (
                        <>
                          <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />
                          <SectionLabel>Hidden</SectionLabel>
                          {filteredHidden.map(renderModel)}
                        </>
                      )}

                      {q && filteredVisible.length === 0 && filteredHidden.length === 0 && (
                        <div className="px-3 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                          No models match “{query.trim()}”
                        </div>
                      )}
                    </div>

                    {allSubmenus.length > 0 && !q && (
                      <>
                        <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />
                        {allSubmenus.map((cfg) => (
                          <OptionSubmenu key={cfg.label} {...cfg} />
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </FloatingFocusManager>
          </FloatingPortal>
        )}
      </TreeCloseContext.Provider>
    </FloatingNode>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function ModelDropdown(props: ModelDropdownProps) {
  return (
    <FloatingTree>
      <ModelDropdownRoot {...props} />
    </FloatingTree>
  );
}
