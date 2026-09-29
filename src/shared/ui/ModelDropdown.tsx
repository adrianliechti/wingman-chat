import {
  autoUpdate,
  FloatingFocusManager,
  FloatingNode,
  FloatingOverlay,
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
  type FloatingContext,
  type Placement,
  type Side,
} from "@floating-ui/react";
import { AlignLeft, Bot, Boxes, Check, ChevronRight, Gauge, Mic, Search, Settings2 } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { cn } from "@/shared/lib/cn";
import type { ModelPreset } from "@/shared/lib/modelPresets";
import type { Model } from "@/shared/types/chat";

// Show the filter box once the visible list is long enough to be unwieldy.
const SEARCH_THRESHOLD = 8;

const PANEL_CLASS =
  "rounded-xl border border-neutral-200/80 dark:border-white/10 bg-white/95 dark:bg-neutral-800/95 backdrop-blur-xl shadow-xl shadow-black/15 dark:shadow-black/60 p-1";

type Effort = NonNullable<Model["effort"]>;

// One name per API level — `xhigh` and `max` are distinct tiers, so they must
// not share a label. Names follow the vendor consoles (…/Extra/Max).
export const EFFORT_LABEL: Record<Effort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
  max: "Max",
};

const EFFORT_HINT = "Higher effort means more thorough responses, but takes longer and costs more.";

type Verbosity = NonNullable<Model["verbosity"]>;

const VERBOSITY_OPTIONS: { value: Verbosity; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const VERBOSITY_HINT = "How long and detailed responses are.";

interface VerbosityConfig {
  /** Current override, or null for the model default. */
  value: Verbosity | null;
  /** The model's configured verbosity, badged on its option. */
  defaultValue?: Verbosity;
  onChange: (verbosity: Verbosity | null) => void;
}

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
  /** Selecting the checked option again clears the selection. */
  allowDeselect?: boolean;
  /** Optional label shown on the trigger when unset. */
  defaultLabel?: string;
}

interface PresetsConfig {
  /** Slider steps, ordered fastest to most capable. */
  steps: ModelPreset[];
  /** Index of the current selection, or -1 when it matches no step. */
  value: number;
  onChange: (index: number) => void;
}

export interface AgentAction {
  icon?: React.ReactNode;
  label: string;
  /** Highlights a row that needs attention, e.g. a pending sign-in. */
  warning?: boolean;
  onSelect: () => void;
}

/** Agents offered next to the models; picking one replaces the model selection. */
interface AgentsConfig {
  items: { id: string; name: string; caption?: string }[];
  /** Active agent id, or null when chatting with a plain model. */
  value: string | null;
  /** Picking the active agent again passes null to turn it off. */
  onChange: (id: string | null) => void;
  /** Opens an agent's settings from the gear on its row. */
  onOpen: (id: string) => void;
  /** Rows after the list, e.g. a pending sign-in. */
  actions?: AgentAction[];
}

interface ModelDropdownProps {
  models: Model[];
  value: string;
  onChange: (modelId: string) => void;
  includeRealtime?: boolean;
  dropdownClassName?: string;
  /** When set, renders an agent submenu before the model and other settings. */
  agents?: AgentsConfig;
  /** When set, renders a reasoning-effort submenu at the bottom of the model list. */
  effort?: EffortConfig;
  /** When set, renders a verbosity submenu after the effort one. */
  verbosity?: VerbosityConfig;
  /** Extra single-select flyout submenus, rendered below the model list (after effort). */
  submenus?: SubmenuConfig[];
  /**
   * When set, the panel opens on a slider across these presets; the full model
   * list stays one click away behind the header.
   */
  presets?: PresetsConfig;
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

// ─── Motion ───────────────────────────────────────────────────────────────────
// Panels unfold from their trigger: a short slide and scale with a soft landing,
// closing a little faster than they open. Reduced motion keeps it a plain cut.

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

// Start slightly toward the trigger, then settle into place.
const SLIDE_FROM: Record<Side, string> = {
  bottom: "translateY(-6px)",
  top: "translateY(6px)",
  right: "translateX(-6px)",
  left: "translateX(6px)",
};

// Scale from the corner nearest the trigger.
function transformOrigin(side: Side, placement: Placement) {
  const align = placement.split("-")[1];
  if (side === "top" || side === "bottom") {
    const x = align === "start" ? "left" : align === "end" ? "right" : "center";
    return `${side === "bottom" ? "top" : "bottom"} ${x}`;
  }
  const y = align === "start" ? "top" : align === "end" ? "bottom" : "center";
  return `${y} ${side === "right" ? "left" : "right"}`;
}

function usePanelTransition(context: FloatingContext, duration: { open: number; close: number }) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  return useTransitionStyles(context, {
    duration: reduceMotion ? 0 : duration,
    initial: ({ side }) => ({
      opacity: 0,
      transform: reduceMotion ? "none" : `${SLIDE_FROM[side]} scale(0.96)`,
    }),
    common: ({ side, placement }) => ({
      transformOrigin: transformOrigin(side, placement),
      transitionTimingFunction: EASE_OUT,
    }),
  });
}

// ─── Tree-aware close ─────────────────────────────────────────────────────────
// The dropdown and its effort flyout share one FloatingTree so the root's
// useDismiss treats a click inside the (portaled) submenu as "inside". Selecting
// anything emits a tree "click" that collapses the whole stack.

const TreeCloseContext = createContext<() => void>(() => {});

// The root panel fades out before it unmounts; flyouts follow its open state so
// they close with it instead of lingering until the fade ends.
const RootOpenContext = createContext(false);

// ─── Flyout submenu ───────────────────────────────────────────────────────────

/** A menu row that opens a side panel on hover or click. */
function Flyout({
  icon,
  label,
  detail,
  panelClassName,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  /** Current value, shown subdued at the end of the row. */
  detail?: string;
  panelClassName?: string;
  children: React.ReactNode;
}) {
  const [openState, setIsOpen] = useState(false);
  const rootOpen = useContext(RootOpenContext);
  const isOpen = openState && rootOpen;

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
  const setReference = (node: Element | null) => refs.setReference(node);
  const setFloating = (node: HTMLElement | null) => refs.setFloating(node);

  const hover = useHover(context, { handleClose: safePolygon(), delay: { close: 150 } });
  const click = useClick(context, { event: "mousedown", toggle: false, ignoreMouse: true });
  const dismiss = useDismiss(context, { bubbles: true });
  const role = useRole(context, { role: "menu" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, click, dismiss, role]);
  const { isMounted, styles: transitionStyles } = usePanelTransition(context, { open: 180, close: 120 });

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

  return (
    <FloatingNode id={nodeId}>
      <button
        ref={setReference}
        type="button"
        data-open={isOpen ? "" : undefined}
        className="group flex w-full items-center gap-2 px-3 py-2 rounded-lg text-left text-sm text-neutral-800 dark:text-neutral-200 transition-colors hover:bg-neutral-100/60 focus:bg-neutral-100/60 focus:outline-none data-open:bg-neutral-100/60 dark:hover:bg-white/5 dark:focus:bg-white/5 dark:data-open:bg-white/5"
        {...getReferenceProps()}
      >
        {icon && <span className="shrink-0 flex justify-center text-neutral-400">{icon}</span>}
        <span className="flex-1 min-w-0">{label}</span>
        {detail && (
          <span className="min-w-0 max-w-40 truncate text-xs text-neutral-500 dark:text-neutral-400">{detail}</span>
        )}
        <ChevronRight size={14} className="shrink-0 text-neutral-400" />
      </button>
      {isMounted && (
        <FloatingPortal>
          <div ref={setFloating} style={floatingStyles} className="z-9999" {...getFloatingProps()}>
            <div style={transitionStyles} className={cn(PANEL_CLASS, panelClassName)}>
              {children}
            </div>
          </div>
        </FloatingPortal>
      )}
    </FloatingNode>
  );
}

function OptionSubmenu({
  icon,
  label,
  hint,
  options,
  value,
  onChange,
  allowDeselect = false,
  defaultLabel,
}: SubmenuConfig) {
  const closeAll = useContext(TreeCloseContext);

  return (
    <Flyout
      icon={icon}
      label={label}
      detail={options.find((o) => o.value === value)?.label ?? (value === null ? defaultLabel : undefined)}
      panelClassName="w-auto min-w-44 max-w-64"
    >
      {hint && <p className="px-3 pt-1.5 pb-2 text-xs leading-snug text-neutral-500 dark:text-neutral-400">{hint}</p>}
      {options.map((opt) => (
        <OptionRow
          key={opt.value}
          name={opt.label}
          description={opt.description}
          badge={opt.badge}
          selected={opt.value === value}
          onSelect={() => {
            onChange(allowDeselect && opt.value === value ? null : opt.value);
            closeAll();
          }}
        />
      ))}
    </Flyout>
  );
}

function AgentSubmenu({ items, value, onChange, onOpen, actions }: AgentsConfig) {
  const closeAll = useContext(TreeCloseContext);

  return (
    <Flyout
      icon={<Bot size={14} />}
      label="Agent"
      detail={items.find((a) => a.id === value)?.name ?? "None"}
      panelClassName="flex w-auto min-w-48 max-w-72 flex-col overflow-hidden"
    >
      <div className="min-h-0 overflow-y-auto scrollbar-thin" style={{ maxHeight: "min(60vh, 24rem)" }}>
        {items.map((a) => {
          const selected = a.id === value;
          return (
            <div
              key={a.id}
              className={cn(
                "group/agent flex items-center gap-1 pr-2 rounded-lg transition-colors",
                selected
                  ? "bg-neutral-100/70 text-neutral-900 dark:bg-white/10 dark:text-neutral-100"
                  : "text-neutral-800 hover:bg-neutral-100/60 has-focus-visible:bg-neutral-100/60 dark:text-neutral-200 dark:hover:bg-white/5 dark:has-focus-visible:bg-white/5",
              )}
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(selected ? null : a.id);
                  closeAll();
                }}
                className="flex flex-1 min-w-0 items-center gap-2 py-2 pl-3 text-left focus:outline-none"
              >
                <span className={cn("flex-1 truncate text-[13px] leading-tight", selected ? "font-semibold" : "font-medium")}>
                  {a.name}
                </span>
                {a.caption && (
                  <span className="truncate text-[11px] leading-tight text-neutral-500 dark:text-neutral-400">{a.caption}</span>
                )}
              </button>
              {/* One slot: the check marks the active agent and gives way to the
                  settings gear on hover. Touch has no hover, so it shows the gear. */}
              <span className="relative flex size-6 shrink-0 items-center justify-center">
                <Check
                  size={14}
                  className={cn(
                    "text-neutral-500 transition-opacity group-hover/agent:opacity-0 pointer-coarse:hidden dark:text-neutral-400",
                    selected ? "opacity-100" : "opacity-0",
                  )}
                />
                <button
                  type="button"
                  aria-label={`Open ${a.name} settings`}
                  title="Agent settings"
                  onClick={() => {
                    onOpen(a.id);
                    closeAll();
                  }}
                  className="absolute inset-0 flex items-center justify-center rounded-md text-neutral-400 opacity-0 transition-opacity hover:text-neutral-700 hover:bg-neutral-200/70 focus-visible:opacity-100 focus:outline-none group-hover/agent:opacity-100 pointer-coarse:opacity-100 dark:hover:text-neutral-200 dark:hover:bg-white/10"
                >
                  <Settings2 size={14} />
                </button>
              </span>
            </div>
          );
        })}
      </div>
      {actions && actions.length > 0 && (
        <>
          <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              onClick={() => {
                action.onSelect();
                closeAll();
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 rounded-lg text-left text-[13px] font-medium transition-colors hover:bg-neutral-100/60 focus:bg-neutral-100/60 focus:outline-none dark:hover:bg-white/5 dark:focus:bg-white/5",
                action.warning
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-neutral-800 dark:text-neutral-200",
              )}
            >
              {action.icon && <span className="shrink-0 flex justify-center text-current opacity-70">{action.icon}</span>}
              <span className="truncate">{action.label}</span>
            </button>
          ))}
        </>
      )}
    </Flyout>
  );
}

// ─── Preset slider ────────────────────────────────────────────────────────────

// Thumb radius in px; steps sit on a line inset by it so the thumb stays on the track.
const THUMB_RADIUS = 12;

// Horizontal offset of step `index` along a track, as a CSS length.
function stepOffset(index: number, count: number) {
  const fraction = count > 1 ? index / (count - 1) : 0;
  return `calc(${THUMB_RADIUS}px + (100% - ${THUMB_RADIUS * 2}px) * ${fraction})`;
}

// `fallbackLabel` names the value for assistive tech when the selection is off the ladder.
function PresetSlider({
  steps,
  value,
  onChange,
  fallbackLabel,
  onPreview,
}: PresetsConfig & {
  fallbackLabel: string;
  /** Reports the step under the thumb while dragging, and null when the drag ends. */
  onPreview: (index: number | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  // Position while dragging; committed on release so a drag across the track
  // doesn't write every intermediate model to the chat.
  const [dragIndex, setDragIndexState] = useState<number | null>(null);
  const setDragIndex = (next: number | null) => {
    setDragIndexState(next);
    onPreview(next);
  };

  const index = dragIndex ?? value;
  const current = steps[index];
  const last = steps.length - 1;
  // Presets define the Faster → Smarter scale, including each model's effort.
  const position = last > 0 ? index / last : 0;
  const accent = position >= 2 / 3 ? "red" : position >= 1 / 2 ? "amber" : "neutral";

  const indexAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const usable = rect.width - THUMB_RADIUS * 2;
    const fraction = usable > 0 ? (clientX - rect.left - THUMB_RADIUS) / usable : 0;
    return Math.min(last, Math.max(0, Math.round(fraction * last)));
  };

  const commit = (next: number) => {
    setDragIndex(null);
    if (next !== value) onChange(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const base = Math.max(0, index);
    const next =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? Math.min(last, base + 1)
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? Math.max(0, base - 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    commit(next);
  };

  return (
    <div className="flex flex-col select-none">
      <div className="px-3 pt-2 pb-1">
        <div className="flex justify-between text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
          <span>Faster</span>
          <span>Smarter</span>
        </div>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Model"
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={Math.max(0, index)}
          aria-valuetext={
            current
              ? [current.label, current.effort && EFFORT_LABEL[current.effort]].filter(Boolean).join(" ")
              : fallbackLabel
          }
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.focus({ preventScroll: true });
            setDragIndex(indexAt(e.clientX));
          }}
          // `select-none` only covers the track; cancelling mousedown stops the drag
          // (or a double-click) from starting a selection in the text around it.
          // That also skips focusing, hence the explicit focus above.
          onMouseDown={(e) => e.preventDefault()}
          onPointerMove={(e) => {
            if (dragIndex !== null) setDragIndex(indexAt(e.clientX));
          }}
          onPointerUp={(e) => {
            if (dragIndex !== null) commit(indexAt(e.clientX));
          }}
          onPointerCancel={() => setDragIndex(null)}
          // A tall hit area around a thin track keeps the target easy to grab.
          className="group/slider relative h-9 w-full cursor-pointer touch-none select-none rounded-full focus:outline-none"
        >
          <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-neutral-200 dark:bg-white/10" />
          {index >= 0 && (
            <div
              className={cn(
                "absolute left-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full transition-[width,background-color] duration-150 ease-out motion-reduce:transition-none",
                accent === "red"
                  ? "bg-red-500/75 dark:bg-red-400/80"
                  : accent === "amber"
                    ? "bg-amber-500/80 dark:bg-amber-400/80"
                    : "bg-neutral-800 dark:bg-neutral-200",
              )}
              style={{ width: stepOffset(index, steps.length) }}
            />
          )}
          {steps.map((step, i) => (
            <span
              key={`${step.model.id}:${step.effort ?? ""}:${i}`}
              className={cn(
                "absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                i <= index ? "bg-white/60 dark:bg-neutral-900/50" : "bg-neutral-300 dark:bg-neutral-600",
              )}
              style={{ left: stepOffset(i, steps.length) }}
            />
          ))}
          {index >= 0 && (
            <div
              className={cn(
                "absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-sm transition-[left,background-color,border-color] duration-150 ease-out group-focus-visible/slider:ring-2 motion-reduce:transition-none",
                accent === "red"
                  ? "border-red-400 bg-red-50 group-focus-visible/slider:ring-red-500/40 dark:border-red-400 dark:bg-red-100 dark:group-focus-visible/slider:ring-red-400/40"
                  : accent === "amber"
                    ? "border-amber-400 bg-amber-50 group-focus-visible/slider:ring-amber-500/40 dark:border-amber-400 dark:bg-amber-100 dark:group-focus-visible/slider:ring-amber-400/40"
                    : "border-neutral-300 bg-white group-focus-visible/slider:ring-slate-500/50 dark:border-neutral-500 dark:bg-neutral-100 dark:group-focus-visible/slider:ring-slate-400/50",
              )}
              style={{ left: stepOffset(index, steps.length) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Root panel ───────────────────────────────────────────────────────────────

function ModelDropdownRoot({
  models,
  value,
  onChange,
  includeRealtime,
  dropdownClassName,
  agents,
  effort,
  verbosity,
  submenus,
  presets,
  trigger,
}: ModelDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const hasPresets = !!presets && presets.steps.length > 1;
  const [showHidden, setShowHidden] = useState(false);

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
  const setReference = (node: Element | null) => refs.setReference(node);
  const setFloating = (node: HTMLElement | null) => refs.setFloating(node);

  const click = useClick(context);
  const role = useRole(context, { role: "menu" });
  const dismiss = useDismiss(context, { bubbles: { escapeKey: false, outsidePress: true } });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, role, dismiss]);

  const { isMounted, styles: transitionStyles } = usePanelTransition(context, { open: 220, close: 150 });
  // The dimmed backdrop fades on its own, slower curve so it eases in behind the panel.
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { isMounted: isOverlayMounted, styles: overlayStyles } = useTransitionStyles(context, {
    duration: reduceMotion ? 0 : { open: 280, close: 200 },
    initial: { opacity: 0 },
    common: { transitionTimingFunction: "ease-out" },
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
  // While dragging the slider, the rows below it show the step under the thumb
  // rather than the committed selection. They aren't interactive mid-drag.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const preview = previewIndex !== null ? presets?.steps[previewIndex] : undefined;
  const shownEffort: EffortConfig | undefined = preview
    ? {
        options: preview.model.supportedEfforts ?? [],
        value: preview.effort ?? null,
        defaultValue: preview.model.defaultEffort,
        onChange: () => {},
      }
    : effort;
  const shownVerbosity: VerbosityConfig | undefined =
    preview && verbosity
      ? {
          ...verbosity,
          // `preview.model` is the configured model, so its verbosity is the default.
          value: preview.verbosity && preview.verbosity !== preview.model.verbosity ? preview.verbosity : null,
          defaultValue: preview.model.verbosity,
        }
      : verbosity;

  const allSubmenus: SubmenuConfig[] = [
    ...(shownEffort && shownEffort.options.length > 0
      ? [
          {
            icon: <Gauge size={14} />,
            label: "Effort",
            hint: EFFORT_HINT,
            options: shownEffort.options.map((o) => ({
              value: o,
              label: EFFORT_LABEL[o],
              badge: o === shownEffort.defaultValue ? "Default" : undefined,
            })),
            value: shownEffort.value ?? shownEffort.defaultValue ?? null,
            onChange: (v: string | null) => {
              if (v) shownEffort.onChange(v as Effort);
            },
          },
        ]
      : []),
    // Only explicit overrides are checked; selecting one again restores the
    // configured verbosity or leaves the choice to the backend.
    ...(shownVerbosity
      ? [
          {
            icon: <AlignLeft size={14} />,
            label: "Verbosity",
            hint: VERBOSITY_HINT,
            options: VERBOSITY_OPTIONS.map((option) => ({
              ...option,
              badge: option.value === shownVerbosity.defaultValue ? "Default" : undefined,
            })),
            value: shownVerbosity.value,
            onChange: (v: string | null) => shownVerbosity.onChange(v as Verbosity | null),
            allowDeselect: true,
            defaultLabel: "Default",
          },
        ]
      : []),
    ...(submenus ?? []),
  ];

  const selectedName = value === "realtime" ? "Real-time Voice" : (models.find((m) => m.id === value)?.name ?? value);

  const modelList = (
    <>
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

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" style={{ maxHeight: "var(--panel-max-h, 24rem)" }}>
        {includeRealtime && !q && (
          <>
            <OptionRow
              name="Real-time Voice"
              icon={<Mic size={13} className="shrink-0" />}
              selected={value === "realtime"}
              onSelect={() => select("realtime")}
            />
            {filteredVisible.length > 0 && <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />}
          </>
        )}

        {filteredVisible.map(renderModel)}

        {showHidden && filteredHidden.length > 0 && (
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
    </>
  );

  return (
    <FloatingNode id={nodeId}>
      {trigger({
        getProps: (overrides) =>
          getReferenceProps({
            ref: setReference,
            ...overrides,
            onPointerDownCapture: (e: React.PointerEvent) => {
              flushSync(() => {
                setShowHidden(e.altKey);
                setQuery("");
              });
              (overrides?.onPointerDownCapture as ((e: React.PointerEvent) => void) | undefined)?.(
                e,
              );
            },
          }),
      })}

      <RootOpenContext.Provider value={isOpen}>
      <TreeCloseContext.Provider value={closeAll}>
        {isOverlayMounted && (
          <FloatingPortal>
            {/* Dims the page so the open panel stands out; a click on it dismisses. */}
            <FloatingOverlay className="z-9998 bg-black/10 dark:bg-black/40" style={overlayStyles} />
          </FloatingPortal>
        )}
        {isMounted && (
          <FloatingPortal>
            <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
              <div
                ref={setFloating}
                style={floatingStyles}
                className="z-9999"
                {...getFloatingProps()}
              >
                <div
                  style={transitionStyles}
                  className={cn(PANEL_CLASS, "flex flex-col overflow-hidden", dropdownClassName, hasPresets && "w-72")}
                >
                  {hasPresets ? (
                    // With presets the slider is the panel; the full list and the
                    // other settings are flyouts, so the panel keeps one layout.
                    <>
                      <PresetSlider {...presets} fallbackLabel={selectedName} onPreview={setPreviewIndex} />
                      <div className="mb-1 h-px bg-neutral-200/60 dark:bg-white/10" />
                      {agents && <AgentSubmenu {...agents} />}
                      <Flyout
                        icon={<Boxes size={14} />}
                        label="Model"
                        detail={preview ? (preview.model.name ?? preview.model.id) : selectedName}
                        panelClassName="flex w-auto min-w-48 max-w-72 flex-col overflow-hidden whitespace-nowrap"
                      >
                        {modelList}
                      </Flyout>
                      {allSubmenus.map((cfg) => (
                        <OptionSubmenu key={cfg.label} {...cfg} />
                      ))}
                    </>
                  ) : (
                    <div className="flex flex-col overflow-hidden" style={{ maxHeight: "var(--panel-max-h, 24rem)" }}>
                      {modelList}
                      {(agents || allSubmenus.length > 0) && !q && (
                        <>
                          <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />
                          {agents && <AgentSubmenu {...agents} />}
                          {allSubmenus.map((cfg) => (
                            <OptionSubmenu key={cfg.label} {...cfg} />
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </FloatingFocusManager>
          </FloatingPortal>
        )}
      </TreeCloseContext.Provider>
      </RootOpenContext.Provider>
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
