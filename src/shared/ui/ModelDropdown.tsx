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
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { cn } from "@/shared/lib/cn";
import { useBreakpoint } from "@/shared/hooks/useMediaQuery";
import { EFFORT_LABEL } from "./effortLabels";
import { ModelSheet } from "./ModelSheet";
import { modelPickerTiers } from "@/shared/lib/modelPicker";
import type { ModelPreset } from "@/shared/lib/modelPresets";
import type { Model } from "@/shared/types/chat";

// Show the filter box once the visible list is long enough to be unwieldy.
const SEARCH_THRESHOLD = 8;

// Tallest the root panel grows, in px, and the room the preset slider takes on top of that.
const PANEL_MAX_HEIGHT = 384;
const SLIDER_HEIGHT = 72;

const PANEL_CLASS =
  "rounded-xl border border-neutral-200/80 dark:border-white/10 bg-white/95 dark:bg-neutral-800/95 backdrop-blur-xl shadow-xl shadow-black/15 dark:shadow-black/60 p-1";

type Effort = NonNullable<Model["effort"]>;

export { EFFORT_LABEL } from "./effortLabels";

const EFFORT_HINT = "Higher effort means more thorough responses, but takes longer and costs more.";

/** Value shown on a setting's row while the setting does not apply to the selection. */
export const NOT_APPLICABLE = "–";

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
  /** Levels the model offers, ordered low to high as shown. Empty keeps the row in place, disabled. */
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
  /** Keeps the row in place, subdued and inert, when the setting does not apply. */
  disabled?: boolean;
}

interface PresetsConfig {
  /** Slider steps, ordered fastest to most capable. */
  steps: ModelPreset[];
  /** Index of the current selection, or -1 when it matches no step. */
  value: number;
  /**
   * Step to mark, subdued, while `value` is -1: the selected model's own step
   * when only its effort or verbosity differ from the preset.
   */
  near?: number;
  onChange: (index: number) => void;
  /** A model that picks the model itself, offered as the slider's first position, ahead of the scale. */
  auto?: { model: Model; selected: boolean; onSelect: () => void };
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

export interface ModelDropdownProps {
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
   * When set, the panel opens on a slider across these presets, above the
   * featured models; the full model list stays one level down.
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
          <span className={cn("truncate text-[13px] leading-tight", selected ? "font-semibold" : "font-medium")}>
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
        className={cn("shrink-0 mt-0.5 text-neutral-500 dark:text-neutral-400", selected ? "opacity-100" : "opacity-0")}
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

// ─── Model list ───────────────────────────────────────────────────────────────

/** A scrolling checklist of models, with a filter box once it grows long. */
function ModelList({
  models,
  hidden,
  realtime,
  value,
  onSelect,
  query,
  onQueryChange,
}: {
  models: Model[];
  /** Appended under their own label. */
  hidden: Model[];
  /** Leads the list with the Real-time Voice row. */
  realtime: boolean;
  value: string;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const matches = (m: Model) =>
    !q ||
    (m.name ?? m.id).toLowerCase().includes(q) ||
    m.id.toLowerCase().includes(q) ||
    (m.description ?? "").toLowerCase().includes(q);
  const shown = q ? models.filter(matches) : models;
  const shownHidden = q ? hidden.filter(matches) : hidden;

  const renderModel = (m: Model) => (
    <OptionRow
      key={m.id}
      name={m.name ?? m.id}
      caption={m.caption}
      description={m.description}
      selected={m.id === value}
      onSelect={() => onSelect(m.id)}
    />
  );

  return (
    <>
      {models.length > SEARCH_THRESHOLD && (
        <div className="mb-1 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-neutral-100/70 dark:bg-white/5">
          <Search size={13} className="shrink-0 text-neutral-400" />
          <input
            type="text"
            ref={(el) => {
              if (el) requestAnimationFrame(() => el.focus());
            }}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search models…"
            aria-label="Search models"
            className="w-full bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 focus:outline-none"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" style={{ maxHeight: "var(--panel-max-h, 24rem)" }}>
        {realtime && !q && (
          <>
            <OptionRow
              name="Real-time Voice"
              icon={<Mic size={13} className="shrink-0" />}
              selected={value === "realtime"}
              onSelect={() => onSelect("realtime")}
            />
            {shown.length > 0 && <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />}
          </>
        )}

        {shown.map((m, i) => (
          // The full list leads with the featured models; a rule sets them apart from the rest.
          <Fragment key={m.id}>
            {!q && i > 0 && !m.featured && shown[i - 1].featured && (
              <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />
            )}
            {renderModel(m)}
          </Fragment>
        ))}

        {shownHidden.length > 0 && (
          <>
            <div className="my-1 h-px bg-neutral-200/60 dark:bg-white/10" />
            <SectionLabel>Hidden</SectionLabel>
            {shownHidden.map(renderModel)}
          </>
        )}

        {q && shown.length === 0 && shownHidden.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            No models match “{query.trim()}”
          </div>
        )}
      </div>
    </>
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
  disabled = false,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  /** Current value, shown subdued at the end of the row. */
  detail?: string;
  panelClassName?: string;
  /** Keeps the row in place, subdued, without opening anything. */
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const [openState, setIsOpen] = useState(false);
  const rootOpen = useContext(RootOpenContext);
  const isOpen = openState && rootOpen && !disabled;

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
        disabled={disabled}
        className="group flex w-full items-center gap-2 px-3 py-2 rounded-lg text-left text-sm text-neutral-800 dark:text-neutral-200 transition-colors hover:bg-neutral-100/60 focus:bg-neutral-100/60 focus:outline-none data-open:bg-neutral-100/60 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-white/5 dark:focus:bg-white/5 dark:data-open:bg-white/5"
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
  disabled = false,
}: SubmenuConfig) {
  const closeAll = useContext(TreeCloseContext);

  return (
    <Flyout
      icon={icon}
      label={label}
      detail={
        disabled
          ? NOT_APPLICABLE
          : (options.find((o) => o.value === value)?.label ?? (value === null ? defaultLabel : undefined))
      }
      panelClassName="w-auto min-w-44 max-w-64"
      disabled={disabled}
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
                <span
                  className={cn(
                    "flex-1 truncate text-[13px] leading-tight",
                    selected ? "font-semibold" : "font-medium",
                  )}
                >
                  {a.name}
                </span>
                {a.caption && (
                  <span className="truncate text-[11px] leading-tight text-neutral-500 dark:text-neutral-400">
                    {a.caption}
                  </span>
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
                action.warning ? "text-amber-600 dark:text-amber-400" : "text-neutral-800 dark:text-neutral-200",
              )}
            >
              {action.icon && (
                <span className="shrink-0 flex justify-center text-current opacity-70">{action.icon}</span>
              )}
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
// Room between the Auto slot and the scale, in px.
const AUTO_GAP = 8;

// Horizontal offset of step `index` along a track, as a CSS length.
function stepOffset(index: number, count: number) {
  const fraction = count > 1 ? index / (count - 1) : 0;
  return `calc(${THUMB_RADIUS}px + (100% - ${THUMB_RADIUS * 2}px) * ${fraction})`;
}

/** Where the thumb can rest: a step of the scale, or the Auto slot ahead of it. */
export type PresetPosition = number | "auto";

// `fallbackLabel` names the value for assistive tech when the selection is off the ladder.
// Shared with the phone sheet, which puts it at the top of its root page.
export function PresetSlider({
  steps,
  value,
  near,
  onChange,
  auto,
  fallbackLabel,
  onPreview,
  live = false,
}: PresetsConfig & {
  fallbackLabel: string;
  /** Reports the position under the thumb while dragging, and null when the drag ends. */
  onPreview?: (position: PresetPosition | null) => void;
  /** Commit every position the thumb crosses instead of waiting for release. */
  live?: boolean;
}) {
  const sliderRef = useRef<HTMLDivElement>(null);
  // Position while dragging. Desktop commits on release so a drag across the
  // track doesn't write every intermediate model to the chat; the phone sheet
  // commits live, since there's no caption to preview into.
  const [drag, setDragState] = useState<PresetPosition | null>(null);

  const select = (next: PresetPosition) => {
    if (next === "auto") {
      if (auto && !auto.selected) auto.onSelect();
    } else if (next !== value) {
      onChange(next);
    }
  };
  const setDrag = (next: PresetPosition | null) => {
    setDragState(next);
    onPreview?.(next);
    if (live && next !== null) select(next);
  };
  const commit = (next: PresetPosition) => {
    setDrag(null);
    select(next);
  };

  const last = steps.length - 1;
  // Auto is the slider's first position, a slot ahead of the scale. A gap sets
  // it apart: it hands the choice to the backend, so it is not the fastest step.
  const scaleStart = auto ? THUMB_RADIUS * 2 + AUTO_GAP : 0;

  const position: PresetPosition | null = drag ?? (auto?.selected ? "auto" : value >= 0 ? value : null);
  const onAuto = position === "auto";
  const current = typeof position === "number" ? steps[position] : undefined;
  // Off the ladder, the selected model can still have a step of its own (same
  // model, other effort or verbosity). That step is marked, subdued, so the
  // thumb doesn't vanish over a small change; any other selection leaves the
  // track empty.
  const approximate = position === null && near !== undefined && near >= 0 && near <= last;
  // The step the fill and the thumb mark, or -1 for none.
  const step = typeof position === "number" ? position : approximate ? near : -1;
  // Presets define the Faster → Smarter scale, including each model's effort.
  const fraction = step >= 0 && last > 0 ? step / last : 0;
  const isTopTier = !approximate && step >= 0 && fraction >= 2 / 3;

  // Thumb centre along the whole control: in the Auto slot, or on its step of the scale.
  const thumbLeft = onAuto
    ? `${THUMB_RADIUS}px`
    : `calc(${scaleStart + THUMB_RADIUS}px + (100% - ${scaleStart + THUMB_RADIUS * 2}px) * ${fraction})`;

  const positionAt = (clientX: number): PresetPosition => {
    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = clientX - rect.left;
    if (auto && x < scaleStart - AUTO_GAP / 2) return "auto";
    const usable = rect.width - scaleStart - THUMB_RADIUS * 2;
    const along = usable > 0 ? (x - scaleStart - THUMB_RADIUS) / usable : 0;
    return Math.min(last, Math.max(0, Math.round(along * last)));
  };

  // Keyboard order: Auto first when offered, then the steps.
  const order: PresetPosition[] = [...(auto ? (["auto"] as const) : []), ...steps.map((_, i) => i)];
  const at = order.indexOf(position ?? step);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // With nothing marked, Right starts at the first step and Left at the first position.
    const target =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? at < 0
          ? order.indexOf(0)
          : Math.min(order.length - 1, at + 1)
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? Math.max(0, at - 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? order.length - 1
              : null;
    if (target === null) return;
    e.preventDefault();
    commit(order[target]);
  };

  const autoName = auto?.model.name ?? "Auto";

  return (
    <div className="px-3 pt-2 pb-1 select-none">
      <div
        className="flex justify-between text-[11px] font-medium text-neutral-400 dark:text-neutral-500"
        style={{ paddingLeft: scaleStart }}
      >
        <span>Faster</span>
        <span>Smarter</span>
      </div>
      <div
        ref={sliderRef}
        role="slider"
        tabIndex={0}
        aria-label="Model"
        aria-valuemin={0}
        aria-valuemax={order.length - 1}
        aria-valuenow={Math.max(0, at)}
        aria-valuetext={
          onAuto
            ? autoName
            : current
              ? [current.label, current.effort && EFFORT_LABEL[current.effort]].filter(Boolean).join(" ")
              : fallbackLabel
        }
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.focus({ preventScroll: true });
          setDrag(positionAt(e.clientX));
        }}
        // `select-none` only covers the track; cancelling mousedown stops the drag
        // (or a double-click) from starting a selection in the text around it.
        // That also skips focusing, hence the explicit focus above.
        onMouseDown={(e) => e.preventDefault()}
        onPointerMove={(e) => {
          if (drag !== null) setDrag(positionAt(e.clientX));
        }}
        onPointerUp={(e) => {
          if (drag !== null) commit(positionAt(e.clientX));
        }}
        onPointerCancel={() => setDrag(null)}
        // A tall hit area around a thin track keeps the target easy to grab.
        className="group/slider relative h-9 w-full cursor-pointer touch-none select-none rounded-full focus:outline-none"
      >
        {auto && (
          // The Auto slot, in the track's own material; the thumb rests on it while Auto is on.
          <div
            title={`${autoName}: picks the model for each request`}
            className="absolute left-0 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-neutral-200 text-[11px] font-semibold leading-none text-neutral-500 transition-colors hover:bg-neutral-300 hover:text-neutral-700 dark:bg-white/10 dark:text-neutral-400 dark:hover:bg-white/20 dark:hover:text-neutral-200"
          >
            A
          </div>
        )}
        <div className="absolute inset-y-0 right-0" style={{ left: scaleStart }}>
          <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-neutral-200 dark:bg-white/10" />
          {step >= 0 && (
            <div
              className={cn(
                "absolute left-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full transition-[width,background-color] duration-150 ease-out motion-reduce:transition-none",
                approximate
                  ? "bg-neutral-400 dark:bg-neutral-500"
                  : isTopTier
                    ? "bg-red-500/75 dark:bg-red-400/80"
                    : "bg-neutral-800 dark:bg-neutral-200",
              )}
              style={{ width: stepOffset(step, steps.length) }}
            />
          )}
          {steps.map((preset, i) => (
            <span
              key={`${preset.model.id}:${preset.effort ?? ""}:${i}`}
              className={cn(
                "absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                i <= step ? "bg-white/60 dark:bg-neutral-900/50" : "bg-neutral-300 dark:bg-neutral-600",
              )}
              style={{ left: stepOffset(i, steps.length) }}
            />
          ))}
        </div>
        {(onAuto || step >= 0) && (
          // One thumb for the whole control: it slides between the Auto slot and the steps.
          <div
            className={cn(
              "pointer-events-none absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-semibold leading-none shadow-sm transition-[left,background-color,border-color] duration-150 ease-out group-focus-visible/slider:ring-2 motion-reduce:transition-none",
              onAuto
                ? // No fill leads up to the Auto slot, so the thumb itself takes the fill's colour there.
                  "border border-neutral-800 bg-neutral-800 text-white group-focus-visible/slider:ring-slate-500/50 dark:border-neutral-500 dark:bg-neutral-100 dark:text-neutral-900 dark:group-focus-visible/slider:ring-slate-400/50"
                : approximate
                  ? // A ring rather than a disc: near this step, not on it.
                    "border-2 border-neutral-400 bg-white group-focus-visible/slider:ring-slate-500/50 dark:border-neutral-400 dark:bg-neutral-800 dark:group-focus-visible/slider:ring-slate-400/50"
                  : isTopTier
                    ? "border border-red-400 bg-red-50 group-focus-visible/slider:ring-red-500/40 dark:border-red-400 dark:bg-red-100 dark:group-focus-visible/slider:ring-red-400/40"
                    : "border border-neutral-300 bg-white group-focus-visible/slider:ring-slate-500/50 dark:border-neutral-500 dark:bg-neutral-100 dark:group-focus-visible/slider:ring-slate-400/50",
            )}
            style={{ left: thumbLeft }}
          >
            {onAuto && "A"}
          </div>
        )}
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
  // The panel's own list and the full list one level down filter separately.
  const [query, setQuery] = useState("");
  const [fullQuery, setFullQuery] = useState("");
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
          // The slider sits above the list, so the cap grows by its height.
          const cap = PANEL_MAX_HEIGHT + (hasPresets ? SLIDER_HEIGHT : 0);
          elements.floating.style.setProperty("--panel-max-h", `${Math.min(availableHeight, cap)}px`);
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

  const select = (id: string) => {
    onChange(id);
    closeAll();
  };

  // Effort is just a submenu with model-specific labels; flatten it in with any
  // caller-provided submenus so they render uniformly below the model list.
  // Every level is explicit here — an unset chat shows the default level checked
  // and badged, rather than offering a separate "let the model decide" row that
  // would send no effort at all.
  // While dragging the slider, the rows below it show the step under the thumb
  // rather than the committed selection. They aren't interactive mid-drag.
  const [previewPosition, setPreviewPosition] = useState<PresetPosition | null>(null);
  const autoModel = presets?.auto?.model;
  const preview: ModelPreset | undefined =
    previewPosition === null
      ? undefined
      : previewPosition !== "auto"
        ? presets?.steps[previewPosition]
        : autoModel && {
            model: autoModel,
            label: autoModel.name ?? autoModel.id,
            effort: autoModel.defaultEffort,
            verbosity: autoModel.verbosity,
          };
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

  // A caller that passes `effort` gets the row whatever the model: without
  // levels it stays in place, disabled, so the panel keeps its layout as the
  // selection changes. While dragging, a caller's row likewise stays put and
  // only its value follows the thumb.
  const effortRow = effort ? shownEffort : undefined;

  const allSubmenus: SubmenuConfig[] = [
    ...(effortRow
      ? [
          {
            icon: <Gauge size={14} />,
            label: "Effort",
            hint: EFFORT_HINT,
            options: effortRow.options.map((o) => ({
              value: o,
              label: EFFORT_LABEL[o],
              badge: o === effortRow.defaultValue ? "Default" : undefined,
            })),
            value: effortRow.value ?? effortRow.defaultValue ?? null,
            onChange: (v: string | null) => {
              if (v) effortRow.onChange(v as Effort);
            },
            disabled: effortRow.options.length === 0,
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

  // The panel lists the quick picks itself; the complete list, when there is
  // more to it, sits one level down. The slider's Auto stop is not repeated as
  // a row. Hidden models and Real-time Voice join the panel's own list, or the
  // full one when the slider stands in for the panel's list.
  const tiers = modelPickerTiers(models, {
    slider: hasPresets,
    exclude: hasPresets ? presets.auto?.model.id : undefined,
  });
  const hasFullList = tiers.all.length > 0;
  const hiddenModels = showHidden ? tiers.hidden : [];
  const inlineHidden = hasFullList ? [] : hiddenModels;
  const listsModels = !hasPresets || tiers.quick.length > 0;
  const inlineRealtime = !!includeRealtime && (listsModels || !hasFullList);
  const showInlineList = listsModels || inlineHidden.length > 0 || inlineRealtime;

  // The row to the full list names the selection unless a row above already shows it.
  const shownId = preview ? preview.model.id : value;
  const shownInline = tiers.quick.some((m) => m.id === shownId) || (inlineRealtime && shownId === "realtime");
  const fullListDetail = shownInline ? undefined : preview ? (preview.model.name ?? preview.model.id) : selectedName;

  const filtering = query.trim() !== "";

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
                setFullQuery("");
              });
              (overrides?.onPointerDownCapture as ((e: React.PointerEvent) => void) | undefined)?.(e);
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
                <div ref={setFloating} style={floatingStyles} className="z-9999" {...getFloatingProps()}>
                  <div
                    style={transitionStyles}
                    className={cn(
                      PANEL_CLASS,
                      "flex flex-col overflow-hidden",
                      dropdownClassName,
                      hasPresets && "w-72",
                    )}
                  >
                    {/* One layout: the slider when there are presets, the quick picks,
                        then the full list and the other settings as flyouts. */}
                    <div className="flex flex-col overflow-hidden" style={{ maxHeight: "var(--panel-max-h, 24rem)" }}>
                      {hasPresets && (
                        <>
                          <PresetSlider {...presets} fallbackLabel={selectedName} onPreview={setPreviewPosition} />
                          <div className="mb-1 h-px shrink-0 bg-neutral-200/60 dark:bg-white/10" />
                        </>
                      )}
                      {showInlineList && (
                        <ModelList
                          models={tiers.quick}
                          hidden={inlineHidden}
                          realtime={inlineRealtime}
                          value={shownId}
                          onSelect={select}
                          query={query}
                          onQueryChange={setQuery}
                        />
                      )}
                      {(agents || hasFullList || allSubmenus.length > 0) && !filtering && (
                        <>
                          {showInlineList && <div className="my-1 h-px shrink-0 bg-neutral-200/60 dark:bg-white/10" />}
                          {agents && <AgentSubmenu {...agents} />}
                          {hasFullList && (
                            <Flyout
                              icon={<Boxes size={14} />}
                              label="Model"
                              detail={fullListDetail}
                              panelClassName="flex w-auto min-w-48 max-w-72 flex-col overflow-hidden whitespace-nowrap"
                            >
                              <ModelList
                                models={tiers.all}
                                hidden={hiddenModels}
                                realtime={!!includeRealtime && !inlineRealtime}
                                value={value}
                                onSelect={select}
                                query={fullQuery}
                                onQueryChange={setFullQuery}
                              />
                            </Flyout>
                          )}
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
      </RootOpenContext.Provider>
    </FloatingNode>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function ModelDropdown(props: ModelDropdownProps) {
  // Phones get a bottom sheet with sub-views instead of anchored flyouts.
  const sheet = !useBreakpoint("md");
  if (sheet) return <ModelSheet {...props} />;
  return (
    <FloatingTree>
      <ModelDropdownRoot {...props} />
    </FloatingTree>
  );
}
