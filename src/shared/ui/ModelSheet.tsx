import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { Check, ChevronLeft, ChevronRight, Settings2, X } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import type { Model } from "@/shared/types/chat";
import { EFFORT_LABEL } from "./effortLabels";
import { PresetSlider, type ModelDropdownProps } from "./ModelDropdown";

type Effort = NonNullable<Model["effort"]>;
type Verbosity = NonNullable<Model["verbosity"]>;

/** One selectable row of a list page. */
interface Option {
  id: string;
  label: string;
  description?: string;
  badge?: string;
  selected: boolean;
  onSelect: () => void;
  trailing?: ReactNode;
}

/** A sub-view: a title, a checklist, and an optional footnote. */
interface Page {
  title: string;
  options: Option[];
  hint?: string;
}

const PUSH = "animate-[sheet-push_280ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none";
const POP = "animate-[sheet-pop_280ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none";

function Group({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-black/8 rounded-[22px] bg-black/4 px-4 dark:divide-white/10 dark:bg-white/6">
      {children}
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-black/6 px-2 py-0.5 text-[12px] font-medium text-neutral-600 dark:bg-white/10 dark:text-neutral-300">
      {children}
    </span>
  );
}

function CheckRow({ label, description, badge, selected, trailing, onSelect }: Option) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        onClick={onSelect}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[17px] text-neutral-900 dark:text-neutral-50">{label}</span>
            {badge && <Badge>{badge}</Badge>}
          </span>
          {description && (
            <span className="mt-0.5 block truncate text-[15px] text-neutral-500 dark:text-neutral-400">
              {description}
            </span>
          )}
        </span>
        <Check
          size={20}
          strokeWidth={2.5}
          className={cn("shrink-0 text-blue-500 transition-opacity", selected ? "opacity-100" : "opacity-0")}
          aria-hidden="true"
        />
      </button>
      {trailing}
    </div>
  );
}

function LinkRow({
  label,
  value,
  badge,
  onClick,
}: {
  label: string;
  value?: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 py-3 text-left">
      <span className="min-w-0 flex-1 truncate text-[17px] text-neutral-900 dark:text-neutral-50">{label}</span>
      {badge && <Badge>{badge}</Badge>}
      {value && <span className="truncate text-[17px] text-neutral-500 dark:text-neutral-400">{value}</span>}
      <ChevronRight size={18} className="shrink-0 text-neutral-400" aria-hidden="true" />
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="press flex size-10 items-center justify-center rounded-full bg-black/6 text-neutral-700 dark:bg-white/10 dark:text-neutral-200"
    >
      {children}
    </button>
  );
}

/**
 * Phone counterpart of ModelDropdown: a bottom sheet listing the presets (or
 * the models), with Model / Agent / Effort / Verbosity rows that push a
 * checklist page inside the same sheet behind a back button, the way the
 * native assistant apps do it.
 */
export function ModelSheet(props: ModelDropdownProps) {
  const {
    models,
    value,
    onChange,
    includeRealtime,
    agents,
    presets,
    effort,
    verbosity,
    submenus = [],
    trigger,
  } = props;
  const [open, setOpen] = useState(false);
  // `null` is the root; a page id pushes that page. Direction drives the slide.
  const [nav, setNav] = useState<{ page: string | null; back: boolean }>({ page: null, back: false });
  // The sheet takes only the space its page needs; the body's height is measured
  // from the page so a change of page animates the sheet to the new size.
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const measurePage = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const update = () => setPageHeight(node.offsetHeight);
    update();
    observerRef.current = new ResizeObserver(update);
    observerRef.current.observe(node);
  }, []);

  const close = () => setOpen(false);
  const show = () => {
    setNav({ page: null, back: false });
    setPageHeight(null);
    setOpen(true);
  };
  const push = (page: string) => setNav({ page, back: false });
  const pop = () => setNav({ page: null, back: true });

  const steps = presets && presets.steps.length > 1 ? presets.steps : null;
  const visibleModels = models.filter((m) => m.id !== "realtime" && !m.hidden);
  const currentModel = visibleModels.find((m) => m.id === value);
  const activeAgent = agents?.items.find((a) => a.id === agents.value) ?? null;

  const modelOptions: Option[] = visibleModels.map((m) => ({
    id: m.id,
    label: m.name ?? m.id,
    description: m.description,
    selected: !activeAgent && m.id === value,
    onSelect: () => {
      onChange(m.id);
      close();
    },
  }));
  if (includeRealtime) {
    modelOptions.unshift({
      id: "realtime",
      label: "Real-time Voice",
      selected: !activeAgent && value === "realtime",
      onSelect: () => {
        onChange("realtime");
        close();
      },
    });
  }

  // Every sub-view is a checklist page; the root links to them.
  const pages: Record<string, Page> = {};
  const links: { id: string; label: string; value?: string; badge?: string }[] = [];

  if (steps) {
    pages.models = { title: "Model", options: modelOptions };
    links.push({ id: "models", label: "Model", value: currentModel?.name ?? value });
  }
  if (agents && agents.items.length > 0) {
    pages.agents = {
      title: "Agent",
      options: [
        {
          id: "none",
          label: "None",
          description: "Chat with the selected model",
          selected: !agents.value,
          onSelect: () => {
            agents.onChange(null);
            close();
          },
        },
        ...agents.items.map((agent) => ({
          id: agent.id,
          label: agent.name,
          description: agent.caption,
          selected: agent.id === agents.value,
          onSelect: () => {
            agents.onChange(agent.id);
            close();
          },
          trailing: (
            <button
              type="button"
              aria-label={`Open ${agent.name}`}
              onClick={() => {
                close();
                agents.onOpen(agent.id);
              }}
              className="press flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-400 dark:text-neutral-500"
            >
              <Settings2 size={18} />
            </button>
          ),
        })),
      ],
    };
    links.push({ id: "agents", label: "Agent", value: activeAgent?.name ?? "None" });
  }
  if (effort && effort.options.length > 0) {
    const current = effort.value ?? effort.defaultValue ?? null;
    pages.effort = {
      title: "Effort",
      hint: "Higher effort means more thorough responses, but takes longer and costs more.",
      options: effort.options.map((level) => ({
        id: level,
        label: EFFORT_LABEL[level],
        badge: level === effort.defaultValue ? "Recommended" : undefined,
        selected: level === current,
        onSelect: () => {
          effort.onChange(level as Effort);
          pop();
        },
      })),
    };
    links.push({
      id: "effort",
      label: "Effort",
      value: current ? EFFORT_LABEL[current] : undefined,
      badge: current && current === effort.defaultValue ? "Recommended" : undefined,
    });
  }
  if (verbosity) {
    pages.verbosity = {
      title: "Verbosity",
      hint: "How long and detailed responses are.",
      options: (["low", "medium", "high"] as Verbosity[]).map((level) => ({
        id: level,
        label: level[0].toUpperCase() + level.slice(1),
        badge: level === verbosity.defaultValue ? "Default" : undefined,
        selected: level === verbosity.value,
        onSelect: () => {
          // Picking the checked level again returns to the model default.
          verbosity.onChange(level === verbosity.value ? null : level);
          pop();
        },
      })),
    };
    const current = verbosity.value ? verbosity.value[0].toUpperCase() + verbosity.value.slice(1) : "Default";
    links.push({ id: "verbosity", label: "Verbosity", value: current });
  }
  submenus.forEach((cfg, index) => {
    const id = `extra-${index}`;
    const current = cfg.options.find((o) => o.value === cfg.value);
    pages[id] = {
      title: cfg.label,
      hint: cfg.hint,
      options: cfg.options.map((o) => ({
        id: o.value,
        label: o.label,
        description: o.description,
        badge: o.badge,
        selected: o.value === cfg.value,
        onSelect: () => {
          cfg.onChange(o.value === cfg.value && cfg.allowDeselect ? null : o.value);
          pop();
        },
      })),
    };
    links.push({ id, label: cfg.label, value: current?.label ?? cfg.defaultLabel, badge: current?.badge });
  });

  const page = nav.page ? pages[nav.page] : null;
  const slide = nav.back ? POP : PUSH;

  return (
    <>
      {trigger({ getProps: (overrides) => ({ ...overrides, onClick: show }) })}
      <Dialog open={open} onClose={close} className="relative z-60">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/40 duration-200 ease-out data-closed:opacity-0 dark:bg-black/60"
        />
        <div className="fixed inset-x-0 bottom-0">
          <DialogPanel
            transition
            className="glass-strong flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-[28px] border-b-0 pb-[max(var(--safe-bottom),0.75rem)] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-closed:translate-y-full"
          >
            <div className="flex shrink-0 justify-center pt-2 pb-1">
              <div className="h-1.5 w-9 rounded-full bg-neutral-400/50 dark:bg-neutral-500/60" />
            </div>
            <div className="relative flex h-12 shrink-0 items-center px-3">
              {page ? (
                <IconButton label="Back" onClick={pop}>
                  <ChevronLeft size={20} />
                </IconButton>
              ) : (
                <IconButton label="Close" onClick={close}>
                  <X size={18} />
                </IconButton>
              )}
              <DialogTitle
                key={nav.page ?? "root"}
                className={cn(
                  "pointer-events-none absolute inset-x-0 text-center text-[17px] font-semibold text-neutral-900 dark:text-neutral-50",
                  slide,
                )}
              >
                {page?.title ?? "Select model"}
              </DialogTitle>
            </div>

            {/* The body animates to each page's height; the page itself is keyed so it
                starts unscrolled and slides in from the side it came from. */}
            <div
              className="min-h-0 overflow-y-auto transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
              style={pageHeight === null ? undefined : { height: `min(${pageHeight}px, calc(85dvh - 6rem))` }}
            >
              <div key={nav.page ?? "root"} ref={measurePage} className={cn("px-3 pt-2 pb-2", slide)}>
                {page ? (
                  <>
                    <Group>
                      {page.options.map((option) => (
                        <CheckRow key={option.id} {...option} />
                      ))}
                    </Group>
                    {page.hint && (
                      <p className="px-4 pt-3 text-[15px] leading-snug text-neutral-500 dark:text-neutral-400">
                        {page.hint}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    {steps && presets ? (
                      // The Faster → Smarter ladder, as on desktop; the full list sits behind "Model".
                      // The Model and Effort rows below already name the selection, so the slider stands alone.
                      <div className="rounded-[22px] bg-black/4 px-2 py-2 dark:bg-white/6">
                        <PresetSlider {...presets} fallbackLabel={currentModel?.name ?? value} live />
                      </div>
                    ) : (
                      <Group>
                        {modelOptions.map((option) => (
                          <CheckRow key={option.id} {...option} />
                        ))}
                      </Group>
                    )}
                    {links.length > 0 && (
                      <Group>
                        {links.map((link) => (
                          <LinkRow
                            key={link.id}
                            label={link.label}
                            value={link.value}
                            badge={link.badge}
                            onClick={() => push(link.id)}
                          />
                        ))}
                      </Group>
                    )}
                  </div>
                )}
              </div>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
