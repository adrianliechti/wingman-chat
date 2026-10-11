import {
  getValue,
  peekValue,
  effect,
  isComponentNode,
  ResolvedBinding,
  WritableBinding,
  type ComponentNode,
  type Signal,
} from "@a2ui/web_core/v1_0";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import {
  Component,
  createContext,
  useCallback,
  useContext,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type CSSProperties,
} from "react";
import { WINGMAN_CATALOG_ID, WINGMAN_PRESENTATIONS } from "@/shared/lib/inlineUi/catalog";
import { cn } from "@/shared/lib/cn";
import { stringify as str } from "@/shared/lib/inlineUi/expression";
import { WingmanComponent } from "./WingmanComponent";
import {
  BasicIcon,
  BasicImage,
  BasicText,
  dateTimeInputType,
  dateTimeInputValue,
  dateTimeModelValue,
  safeMediaUrl,
} from "./BasicContent";
import { ChoiceControl } from "@/shared/ui/forms/ChoiceControl";
import { buttonClass, fieldLabelClass, inputClass, primaryButtonClass } from "@/shared/ui/forms/controlStyles";
import { FieldValidationContext } from "./validationContext";

export function useSignalValue<T>(signal: Signal<T>): T {
  const subscribe = useCallback(
    (notify: () => void) =>
      effect(() => {
        getValue(signal);
        notify();
      }),
    [signal],
  );
  const snapshot = useCallback(() => peekValue(signal), [signal]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export const InlineUiViewContext = createContext<{ streaming: boolean; renderText?: (text: string) => ReactNode }>({
  streaming: false,
});
const SubmittedContext = createContext(false);
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

function unwrap(value: unknown): unknown {
  if (value instanceof ResolvedBinding) return value.value;
  if (isComponentNode(value)) return value;
  if (Array.isArray(value)) return value.map(unwrap);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrap(item)]));
  return value;
}

function Child({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return <>{value.map((node) => (isComponentNode(node) ? <NodeView key={node.id} node={node} /> : null))}</>;
  return isComponentNode(value) ? <NodeView node={value} /> : null;
}

function hasInvalidFields(value: unknown, seen = new Set<ComponentNode>(), track = false): boolean {
  if (isComponentNode(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const props = obj(unwrap(track ? getValue(value.props) : peekValue(value.props)));
    if (props.visible === false || props.disabled === true) return false;
    return props.isValid === false || Object.values(props).some((child) => hasInvalidFields(child, seen, track));
  }
  if (Array.isArray(value)) return value.some((child) => hasInvalidFields(child, seen, track));
  if (value && typeof value === "object")
    return Object.values(value).some((child) => hasInvalidFields(child, seen, track));
  return false;
}

function UiForm({
  children,
  submitted,
  disabled,
  submit,
  onAttempt,
  onValidSubmit,
}: {
  children: unknown;
  submitted: boolean;
  disabled: boolean;
  submit: string;
  onAttempt: () => void;
  onValidSubmit: () => void;
}) {
  // Child ComponentNode references remain stable while their props signals
  // change. Read those signals in a subscription instead of memoizing a walk
  // of the child array during render (which React Compiler can cache).
  const subscribe = useCallback(
    (notify: () => void) =>
      effect(() => {
        hasInvalidFields(children, new Set(), true);
        notify();
      }),
    [children],
  );
  const snapshot = useCallback(() => hasInvalidFields(children), [children]);
  const invalid = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <SubmittedContext value={submitted}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onAttempt();
          if (!hasInvalidFields(children)) onValidSubmit();
        }}
      >
        <Child value={children} />
        {submitted && invalid && (
          <p role="alert" className="text-xs text-red-600">
            Check the highlighted fields.
          </p>
        )}
        <button type="submit" disabled={disabled} className={cn(buttonClass, primaryButtonClass)}>
          {submit}
        </button>
      </form>
    </SubmittedContext>
  );
}

function UiTabs({ tabs }: { tabs: unknown }) {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const items = Array.isArray(tabs) ? tabs.map(obj) : [];
  const active = Math.min(selected, items.length - 1);
  return (
    <div>
      <div role="tablist" className="flex gap-2 border-b border-neutral-300 dark:border-neutral-700">
        {items.map((tab, i) => (
          <button
            key={i}
            id={`${id}-tab-${i}`}
            role="tab"
            type="button"
            aria-controls={`${id}-panel-${i}`}
            aria-selected={active === i}
            tabIndex={active === i ? 0 : -1}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (i + 1) % items.length
                  : event.key === "ArrowLeft"
                    ? (i + items.length - 1) % items.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? items.length - 1
                        : undefined;
              if (next !== undefined) {
                event.preventDefault();
                setSelected(next);
                document.getElementById(`${id}-tab-${next}`)?.focus();
              }
            }}
            onClick={() => setSelected(i)}
            className={cn(
              "rounded-t-md border-b-2 border-transparent px-3 py-2.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-400/50 dark:text-neutral-400 dark:hover:text-neutral-100",
              active === i &&
                "border-neutral-800 font-medium text-neutral-900 dark:border-neutral-200 dark:text-neutral-100",
            )}
          >
            {str(tab.title)}
          </button>
        ))}
      </div>
      {items.map((tab, i) => (
        <div
          key={i}
          id={`${id}-panel-${i}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${i}`}
          hidden={active !== i}
          className="pt-3"
        >
          <Child value={tab.child} />
        </div>
      ))}
    </div>
  );
}

function UiModal({ trigger, content }: { trigger: unknown; content: unknown }) {
  const [open, setOpen] = useState(false);
  const { streaming } = useContext(InlineUiViewContext);
  return (
    <>
      <div
        onClick={() => {
          if (!streaming) setOpen(true);
        }}
      >
        <Child value={trigger} />
      </div>
      <Dialog open={open} onClose={setOpen} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-5 dark:bg-neutral-900">
            <DialogTitle className="sr-only">Details</DialogTitle>
            <Child value={content} />
            <button className={cn(buttonClass, "mt-3")} onClick={() => setOpen(false)}>
              Close
            </button>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}

function ChoicePicker({
  props,
  disabled,
  change,
  validation,
}: {
  props: Record<string, unknown>;
  disabled: boolean;
  change: (value: unknown) => void;
  validation: Record<string, unknown>;
}) {
  const [query, setQuery] = useState("");
  const id = useId();
  const options = Array.isArray(props.options) ? props.options.map(obj) : [];
  const selected = Array.isArray(props.value) ? props.value.map(str) : [];
  const multiple = props.variant === "multipleSelection";
  return (
    <fieldset disabled={disabled} {...validation} className="flex flex-col gap-2 text-sm">
      {props.label != null && <legend className={cn(fieldLabelClass, "mb-1.5")}>{str(props.label)}</legend>}
      {props.filterable === true && (
        <input
          type="search"
          className={inputClass}
          aria-label="Filter options"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div className={cn("flex gap-2", props.displayStyle === "chips" ? "flex-wrap" : "flex-col")}>
        {options
          .filter((option) => str(option.label).toLowerCase().includes(query.toLowerCase()))
          .map((option) => (
            <ChoiceControl
              key={str(option.value)}
              type={multiple ? "checkbox" : "radio"}
              chip={props.displayStyle === "chips"}
              name={id}
              disabled={disabled}
              checked={selected.includes(str(option.value))}
              {...validation}
              onChange={(event) =>
                change(
                  multiple
                    ? event.target.checked
                      ? [...selected, str(option.value)]
                      : selected.filter((v) => v !== option.value)
                    : [str(option.value)],
                )
              }
            >
              {str(option.label)}
            </ChoiceControl>
          ))}
      </div>
    </fieldset>
  );
}

export function NodeView({ node }: { node: ComponentNode }) {
  const bindings = useSignalValue(node.props);
  return (
    <NodeErrorBoundary key={node.id} component={node.type} resetKey={bindings}>
      <ResolvedNodeView node={node} bindings={bindings} />
    </NodeErrorBoundary>
  );
}

class NodeErrorBoundary extends Component<
  { component: string; resetKey: unknown; children: ReactNode },
  { error: boolean; resetKey: unknown }
> {
  constructor(props: { component: string; resetKey: unknown; children: ReactNode }) {
    super(props);
    this.state = { error: false, resetKey: props.resetKey };
  }
  static getDerivedStateFromError() {
    return { error: true };
  }
  static getDerivedStateFromProps(props: { resetKey: unknown }, state: { resetKey: unknown }) {
    return props.resetKey === state.resetKey ? null : { error: false, resetKey: props.resetKey };
  }
  override render() {
    return this.state.error ? (
      <p role="alert" className="text-xs text-red-600">
        Cannot render {this.props.component}.
      </p>
    ) : (
      this.props.children
    );
  }
}

/** The SDK owns bindings, actions, validation and child resolution; React owns presentation. */
function ResolvedNodeView({ node, bindings }: { node: ComponentNode; bindings: Record<string, unknown> }) {
  const props = obj(unwrap(bindings));
  const view = useContext(InlineUiViewContext);
  const submitted = useContext(SubmittedContext);
  const [touched, setTouched] = useState(false);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  if (node.isPlaceholder)
    return (
      <span className="text-xs text-neutral-500">
        {node.state === "pending" ? "Building interface…" : `Cannot render ${node.componentId}: ${node.state}`}
      </span>
    );
  if (props.visible === false) return null;
  const disabled = view.streaming || props.disabled === true || busy;
  const errors = Array.isArray(props.validationErrors) ? props.validationErrors.map(str) : [];
  const showErrors = !view.streaming && (touched || submitted || formSubmitted) && errors.length > 0;
  const validation = {
    "aria-invalid": showErrors || undefined,
    "aria-errormessage": showErrors ? `${id}-errors` : undefined,
  };
  const accessibility = obj(props.accessibility);
  const change = (value: unknown) => {
    if (!disabled && bindings.value instanceof WritableBinding) bindings.value.set(value);
  };
  const invoke = async () => {
    if (disabled || props.isValid === false || typeof props.action !== "function") return;
    setBusy(true);
    setActionError("");
    try {
      await props.action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const label = (control: ReactNode) => (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className={fieldLabelClass}>{str(props.label)}</span>
      {control}
    </label>
  );
  const readonly = !(bindings.value instanceof WritableBinding);
  let content: ReactNode;
  const wingman = node.context?.componentModel.catalog?.id === WINGMAN_CATALOG_ID;
  const presentation = wingman ? WINGMAN_PRESENTATIONS[node.type as keyof typeof WINGMAN_PRESENTATIONS] : undefined;
  if (presentation) {
    content = (
      <FieldValidationContext value={validation}>
        <WingmanComponent
          type={presentation}
          props={{
            ...props,
            disabled:
              disabled ||
              ("value" in props &&
                readonly &&
                ["Select", "MultiSelect", "Segmented", "Radio", "Toggle", "Stepper", "Checklist"].includes(node.type)),
          }}
          value={props.value}
          onChange={change}
          renderText={view.renderText}
        >
          <Child value={props.children} />
        </WingmanComponent>
      </FieldValidationContext>
    );
  } else
    switch (node.type) {
      case "Column":
      case "Row":
      case "List": {
        const horizontal = node.type === "Row" || (node.type === "List" && props.direction === "horizontal");
        const justify: Record<string, CSSProperties["justifyContent"]> = {
          start: "flex-start",
          end: "flex-end",
          center: "center",
          spaceBetween: "space-between",
          spaceAround: "space-around",
          spaceEvenly: "space-evenly",
          stretch: "stretch",
        };
        const align: Record<string, CSSProperties["alignItems"]> = {
          start: "flex-start",
          end: "flex-end",
          center: "center",
          stretch: "stretch",
        };
        content = (
          <div
            className={cn(
              "flex min-w-0 gap-3",
              horizontal ? "flex-row" : "flex-col",
              node.type === "List" && "overflow-auto",
            )}
            style={{
              justifyContent: justify[str(props.justify)] ?? "flex-start",
              alignItems: align[str(props.align)] ?? "stretch",
            }}
          >
            <Child value={props.children} />
          </div>
        );
        break;
      }
      case "Text":
        content = <BasicText text={str(props.text)} variant={props.variant} />;
        break;
      case "Image":
        content = (
          <BasicImage url={props.url} description={props.description} variant={props.variant} fit={props.fit} />
        );
        break;
      case "Icon":
        content = <BasicIcon name={props.name} />;
        break;
      case "Video":
        content = (
          <video
            controls
            preload="metadata"
            src={safeMediaUrl(props.url)}
            poster={safeMediaUrl(props.posterUrl)}
            className="max-h-96 max-w-full"
          />
        );
        break;
      case "AudioPlayer":
        content = (
          <audio
            controls
            preload="metadata"
            src={safeMediaUrl(props.url)}
            aria-label={str(props.description)}
            className="max-w-full"
          />
        );
        break;
      case "Card":
        content = (
          <section className="rounded-xl border border-neutral-200/80 bg-white p-4 shadow-xs dark:border-neutral-800 dark:bg-neutral-900/40">
            <Child value={props.child} />
          </section>
        );
        break;
      case "Divider":
        content = (
          <div
            role="separator"
            aria-orientation={props.axis === "vertical" ? "vertical" : "horizontal"}
            className={
              props.axis === "vertical"
                ? "h-full min-h-4 border-l border-neutral-300 dark:border-neutral-700"
                : "w-full border-t border-neutral-300 dark:border-neutral-700"
            }
          />
        );
        break;
      case "Tabs":
        content = <UiTabs tabs={props.tabs} />;
        break;
      case "Modal":
        content = <UiModal trigger={props.trigger} content={props.content} />;
        break;
      case "Button":
        content = (
          <button
            type="button"
            disabled={disabled || props.isValid === false}
            onClick={() => void invoke()}
            className={cn(
              buttonClass,
              props.variant === "primary" && primaryButtonClass,
              props.variant === "borderless" &&
                "border-transparent bg-transparent shadow-none dark:border-transparent dark:bg-transparent",
            )}
          >
            <Child value={props.child} />
          </button>
        );
        break;
      case "TextField": {
        const input = {
          id,
          className: inputClass,
          value: str(props.value),
          disabled,
          readOnly: readonly,
          placeholder: str(props.placeholder),
          ...validation,
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(event.target.value),
        };
        content = label(
          props.variant === "longText" ? (
            <textarea {...input} rows={3} />
          ) : (
            <input
              {...input}
              type={props.variant === "obscured" ? "password" : props.variant === "number" ? "number" : "text"}
            />
          ),
        );
        break;
      }
      case "CheckBox":
        content = (
          <ChoiceControl
            type="checkbox"
            checked={props.value === true}
            disabled={disabled || readonly}
            onChange={(event) => change(event.target.checked)}
            {...validation}
          >
            {str(props.label)}
          </ChoiceControl>
        );
        break;
      case "Slider": {
        const min = Number(props.min ?? 0),
          max = Number(props.max);
        content = label(
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={min}
              max={max}
              step={props.steps ? (max - min) / Number(props.steps) : "any"}
              value={Number(props.value ?? min)}
              disabled={disabled || readonly}
              onChange={(event) => change(event.target.valueAsNumber)}
              className="w-full cursor-pointer accent-neutral-800 focus-visible:rounded-full focus-visible:ring-2 focus-visible:ring-neutral-400/50 disabled:cursor-not-allowed disabled:opacity-50 dark:accent-neutral-200"
              {...validation}
            />
            <output className="min-w-10 rounded-md bg-neutral-100 px-2 py-1 text-center text-xs font-medium tabular-nums text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {str(props.value)}
            </output>
          </div>,
        );
        break;
      }
      case "ChoicePicker":
        content = (
          <ChoicePicker props={props} disabled={disabled || readonly} change={change} validation={validation} />
        );
        break;
      case "DateTimeInput": {
        const type = dateTimeInputType(props.enableDate, props.enableTime);
        content = label(
          <input
            type={type}
            value={dateTimeInputValue(props.value, type)}
            min={dateTimeInputValue(props.min, type)}
            max={dateTimeInputValue(props.max, type)}
            step={type === "time" || type === "datetime-local" ? "any" : undefined}
            disabled={disabled}
            readOnly={readonly || type === "text"}
            className={inputClass}
            onChange={(event) => {
              if (type !== "text") change(dateTimeModelValue(event.target.value, props.value, type));
            }}
            {...validation}
          />,
        );
        break;
      }
      case "Form":
        content = (
          <UiForm
            submitted={formSubmitted}
            disabled={disabled}
            submit={str(props.submit)}
            onAttempt={() => setFormSubmitted(true)}
            onValidSubmit={() => void invoke()}
          >
            {props.children}
          </UiForm>
        );
        break;
      default:
        content = <span role="alert">Unsupported component: {node.type}</span>;
    }
  return (
    <div
      data-a2ui-component={node.type}
      data-a2ui-id={node.componentId}
      className="min-w-0"
      onBlur={() => setTouched(true)}
      style={props.weight == null ? undefined : { flexGrow: Number(props.weight), flexBasis: 0 }}
      aria-label={accessibility.label == null ? undefined : str(accessibility.label)}
      aria-description={accessibility.description == null ? undefined : str(accessibility.description)}
      aria-live={accessibility.live as "off" | "polite" | "assertive" | undefined}
      aria-hidden={accessibility.hidden === true || undefined}
    >
      {content}
      {errors.length > 0 && (
        // Reserve error space before blur: revealing a message must not move
        // the submit button between pointerdown and pointerup and lose clicks.
        <p
          id={`${id}-errors`}
          role={showErrors ? "alert" : undefined}
          aria-hidden={!showErrors || undefined}
          className={cn("mt-1 text-xs text-red-600", !showErrors && "invisible")}
        >
          {errors.join(". ")}
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-xs text-red-600">
          {actionError}
        </p>
      )}
    </div>
  );
}
