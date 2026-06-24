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

const EFFORT_META: Record<Effort, { label: string; description: string }> = {
  none: { label: "None", description: "No reasoning — fastest" },
  minimal: { label: "Minimal", description: "Very light reasoning" },
  low: { label: "Low", description: "Brief reasoning" },
  medium: { label: "Medium", description: "Balanced — recommended" },
  high: { label: "High", description: "Deeper reasoning" },
  xhigh: { label: "Max", description: "Deepest reasoning — slowest" },
};

interface EffortConfig {
  /** Levels the model offers, ordered as shown. */
  options: Effort[];
  /** Current selection, or null for the model/backend default. */
  value: Effort | null;
  /** Pass null to clear back to the default. */
  onChange: (effort: Effort | null) => void;
}

interface ModelDropdownProps {
  models: Model[];
  value: string;
  onChange: (modelId: string) => void;
  includeRealtime?: boolean;
  dropdownClassName?: string;
  /** When set, renders a reasoning-effort submenu at the bottom of the model list. */
  effort?: EffortConfig;
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
  description,
  selected,
  icon,
  onSelect,
}: {
  name: string;
  description?: string;
  selected: boolean;
  icon?: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={description}
      className={cn(
        "group flex w-full items-start gap-2 px-3 py-2 rounded-lg text-left transition-colors hover:bg-neutral-100/60 focus:bg-neutral-100/60 focus:outline-none dark:hover:bg-white/5 dark:focus:bg-white/5",
        selected ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-800 dark:text-neutral-200",
      )}
    >
      {icon && <span className="shrink-0 mt-0.5 flex justify-center text-neutral-400">{icon}</span>}
      <span className="flex flex-col items-start flex-1 min-w-0">
        <span className={cn("text-sm leading-tight", selected ? "font-semibold" : "font-normal")}>{name}</span>
        {description && (
          <span className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 leading-snug opacity-90">
            {description}
          </span>
        )}
      </span>
      <Check
        size={14}
        className={cn("shrink-0 mt-0.5 text-neutral-500 dark:text-neutral-400", selected ? "opacity-100" : "opacity-0")}
      />
    </button>
  );
}

// ─── Tree-aware close ─────────────────────────────────────────────────────────
// The dropdown and its effort flyout share one FloatingTree so the root's
// useDismiss treats a click inside the (portaled) submenu as "inside". Selecting
// anything emits a tree "click" that collapses the whole stack.

const TreeCloseContext = createContext<() => void>(() => {});

// ─── Effort flyout submenu ────────────────────────────────────────────────────

function EffortSubmenu({ options, value, onChange }: EffortConfig) {
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

  // Collapse when a sibling submenu opens (none today, but keeps parity with the
  // Add menu and is correct if more flyouts are added).
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

  return (
    <FloatingNode id={nodeId}>
      <button
        ref={refs.setReference}
        type="button"
        data-open={isOpen ? "" : undefined}
        className="group flex w-full items-center gap-2 px-3 py-2 rounded-lg text-left text-sm text-neutral-800 dark:text-neutral-200 transition-colors hover:bg-neutral-100/60 focus:bg-neutral-100/60 focus:outline-none data-open:bg-neutral-100/60 dark:hover:bg-white/5 dark:focus:bg-white/5 dark:data-open:bg-white/5"
        {...getReferenceProps()}
      >
        <Gauge size={14} className="shrink-0 text-neutral-400" />
        <span className="flex-1 min-w-0">Effort</span>
        {value && (
          <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{EFFORT_META[value].label}</span>
        )}
        <ChevronRight size={14} className="shrink-0 text-neutral-400" />
      </button>
      {isOpen && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} className="z-9999" {...getFloatingProps()}>
            <div className={cn(PANEL_CLASS, "w-auto min-w-44")}>
              <OptionRow
                name="Default"
                description="Let the model decide"
                selected={value === null}
                onSelect={() => {
                  onChange(null);
                  closeAll();
                }}
              />
              <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />
              {options.map((opt) => (
                <OptionRow
                  key={opt}
                  name={EFFORT_META[opt].label}
                  description={EFFORT_META[opt].description}
                  selected={opt === value}
                  onSelect={() => {
                    onChange(opt);
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
          elements.floating.style.setProperty("--panel-max-h", `${Math.min(availableHeight, 384)}px`);
        },
        padding: 8,
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const role = useRole(context, { role: "menu" });
  const dismiss = useDismiss(context, { bubbles: true });
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
              (overrides?.onPointerDownCapture as ((e: React.PointerEvent) => void) | undefined)?.(e);
            },
          }),
      })}

      <TreeCloseContext.Provider value={closeAll}>
        {isMounted && (
          <FloatingPortal>
            <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
              <div ref={refs.setFloating} style={floatingStyles} className="z-50" {...getFloatingProps()}>
                <div
                  style={transitionStyles}
                  className={cn(PANEL_CLASS, "flex flex-col overflow-hidden", dropdownClassName)}
                >
                  <div className="flex flex-col overflow-hidden" style={{ maxHeight: "var(--panel-max-h, 24rem)" }}>
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

                      {filteredVisible.map((m) => (
                        <OptionRow
                          key={m.id}
                          name={m.name ?? m.id}
                          description={m.description}
                          selected={m.id === value}
                          onSelect={() => select(m.id)}
                        />
                      ))}

                      {showHiddenRef.current && filteredHidden.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 border-y border-neutral-200/60 dark:border-white/10">
                            Hidden
                          </div>
                          {filteredHidden.map((m) => (
                            <OptionRow
                              key={m.id}
                              name={m.name ?? m.id}
                              description={m.description}
                              selected={m.id === value}
                              onSelect={() => select(m.id)}
                            />
                          ))}
                        </>
                      )}

                      {q && filteredVisible.length === 0 && filteredHidden.length === 0 && (
                        <div className="px-3 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                          No models match “{query.trim()}”
                        </div>
                      )}
                    </div>

                    {effort && effort.options.length > 0 && !q && (
                      <>
                        <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />
                        <EffortSubmenu {...effort} />
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
