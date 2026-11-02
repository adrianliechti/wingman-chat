import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { getToolDisplayName } from "@/shared/lib/utils";
import { Markdown } from "@/shared/ui/Markdown";
import { ChoiceControl } from "@/shared/ui/forms/ChoiceControl";
import {
  RequestHeader,
  requestCardClass,
  requestBodyClass,
  requestActionsClass,
  primaryRequestButtonClass,
  quietRequestButtonClass,
  requestButtonClass,
} from "./RequestCard";
import { fieldLabelClass, inputClass } from "@/shared/ui/forms/controlStyles";
import type {
  ElicitationPrimitiveSchema,
  ElicitationResult,
  FormElicitation,
  QuestionChoice,
  QuestionPresentation,
} from "@/shared/types/elicitation";
import {
  buildInitialElicitationValues,
  getInputType,
  getMultiSelectOptions,
  getSingleSelectOptions,
  isBooleanSchema,
  isMultiSelectSchema,
  isNumberSchema,
  isSingleSelectSchema,
  isStringSchema,
  startCase,
  validateElicitationForm,
  type ElicitationDraftValue,
} from "../lib/elicitationForm";

const quietButton =
  "rounded-md px-2 py-1 text-xs text-neutral-500 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-neutral-400 dark:hover:text-neutral-100";

export function ElicitationForm({
  toolName,
  elicitation,
  onResolve,
}: {
  toolName: string;
  elicitation: FormElicitation;
  onResolve: (result: ElicitationResult) => void;
}) {
  const schema = elicitation.requestedSchema!;
  const questions = elicitation.presentation?.kind === "questions";
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const focusError = useRef(false);
  const [values, setValues] = useState(() => buildInitialElicitationValues(schema));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fieldOrder = elicitation.presentation?.fieldOrder ?? [];
  const fields = [...new Set([...fieldOrder, ...Object.keys(schema.properties)])]
    .filter((name) => Object.hasOwn(schema.properties, name))
    .map((name) => [name, schema.properties[name]] as const);
  const carousel = questions && elicitation.presentation?.layout === "carousel" && fields.length > 1;
  // step === fields.length is the review step.
  const [step, setStep] = useState(0);
  // Set when the person jumped here from the review step, so finishing the edit returns to it.
  const [fromReview, setFromReview] = useState(false);
  const reviewing = carousel && step === fields.length;
  const go = (to: number) => {
    setStep(to);
    if (to === fields.length) setFromReview(false);
  };
  const advance = () => go(fromReview ? fields.length : step + 1);
  const shownStep = useRef(0);
  // Hidden questions drop out of the accessibility tree, so move focus (and the announcement) with the step.
  useEffect(() => {
    if (!carousel || shownStep.current === step) return;
    shownStep.current = step;
    if (focusError.current) return;
    if (reviewing) {
      const title = document.getElementById(`${id}-title`);
      title?.setAttribute("tabindex", "-1");
      title?.focus();
      return;
    }
    const scope = form.current?.querySelector(`[data-step="${step}"]`);
    const target =
      scope?.querySelector<HTMLElement>("input:checked") ??
      scope?.querySelector<HTMLElement>("input, textarea, select");
    target?.focus();
  }, [step]);
  useEffect(() => {
    if (focusError.current) {
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      focusError.current = false;
    }
  }, [errors]);

  const clearError = (name: string) =>
    setErrors((current) => {
      if (!Object.hasOwn(current, name)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  // Validates only the question on screen, so later questions never block moving forward.
  const goNext = () => {
    const [name, field] = fields[step];
    const result = validateElicitationForm(
      { ...schema, properties: { [name]: field }, required: schema.required?.filter((key) => key === name) },
      values,
    );
    focusError.current = !!result.errors;
    // Only this question's error is replaced; errors held for other questions stay.
    setErrors((current) => {
      const { [name]: _replaced, ...others } = current;
      return { ...others, ...result.errors };
    });
    if (!result.errors) advance();
  };
  const answerText = (name: string, field: ElicitationPrimitiveSchema): string | undefined => {
    const value = values[name];
    const options = elicitation.presentation?.fields[name]?.options;
    const label = (item: string) => options?.find((option) => option.value === item)?.label ?? item;
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.length ? value.map(label).join(", ") : undefined;
    if (typeof value === "string" && value.trim()) {
      return isSingleSelectSchema(field) && !options
        ? (getSingleSelectOptions(field).find((option) => option.value === value)?.label ?? value)
        : label(value.trim());
    }
    return undefined;
  };
  return (
    <form
      ref={form}
      noValidate
      aria-labelledby={`${id}-title`}
      className={requestCardClass}
      onKeyDown={(event) => {
        if (carousel && event.key === "Enter" && event.repeat && event.target instanceof HTMLInputElement)
          event.preventDefault();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (carousel && !reviewing) {
          goNext();
          return;
        }
        const result = validateElicitationForm(schema, values);
        focusError.current = !!result.errors;
        setErrors(result.errors ?? {});
        if (result.errors) {
          // Take the person back to the first question that needs attention.
          const first = fields.findIndex(([name]) => result.errors && Object.hasOwn(result.errors, name));
          if (carousel && first >= 0) go(first);
        } else onResolve({ action: "accept", content: result.content });
      }}
    >
      <div className={requestBodyClass}>
        <RequestHeader
          id={`${id}-title`}
          source={questions ? undefined : (elicitation.source ?? getToolDisplayName(toolName))}
          title={
            carousel
              ? reviewing
                ? "Review your answers"
                : `Question ${step + 1} of ${fields.length}`
              : questions
                ? fields.length === 1
                  ? "A quick question"
                  : "A few quick questions"
                : "A few details to continue"
          }
        />
        {carousel && (
          <div
            className="flex gap-1"
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={1}
            aria-valuemax={fields.length}
            aria-valuenow={Math.min(step + 1, fields.length)}
            aria-valuetext={reviewing ? "Review your answers" : `Question ${step + 1} of ${fields.length}`}
          >
            {Array.from({ length: fields.length + 1 }, (_, index) => (
              <span
                key={index}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  index <= step ? "bg-neutral-500 dark:bg-neutral-300" : "bg-neutral-200 dark:bg-neutral-700",
                )}
              />
            ))}
          </div>
        )}
        {carousel && (
          <p className="sr-only" role="status">
            {reviewing
              ? "Review your answers"
              : `Question ${step + 1} of ${fields.length}: ${fields[step][1].title || startCase(fields[step][0])}`}
          </p>
        )}
        {elicitation.message && (
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            <Markdown compact>{elicitation.message}</Markdown>
          </div>
        )}
        <div className="space-y-5">
          {fields.map(([name, field], index) => (
            // Hidden rather than unmounted, so typed text survives Back/Next.
            <div key={name} data-step={index} hidden={!!carousel && step !== index}>
              <ElicitationField
                id={`${id}-${index}`}
                label={field.title || startCase(name)}
                schema={field}
                presentation={elicitation.presentation?.fields[name]}
                question={questions}
                required={schema.required?.includes(name) ?? false}
                value={values[name]}
                error={Object.hasOwn(errors, name) ? errors[name] : undefined}
                onChange={(value) => {
                  setValues((current) => ({ ...current, [name]: value }));
                  clearError(name);
                }}
                // Picking a single option (not typing a custom answer) moves on by itself.
                onPick={carousel && index === step ? advance : undefined}
              />
            </div>
          ))}
          {reviewing && (
            <ul className="space-y-3">
              {fields.map(([name, field], index) => {
                const answer = answerText(name, field);
                return (
                  <li key={name} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">{field.title || startCase(name)}</p>
                      <p
                        className={cn(
                          "text-sm break-words",
                          answer ? "text-neutral-800 dark:text-neutral-200" : "text-neutral-400 italic",
                        )}
                      >
                        {answer ?? "Skipped"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={quietButton}
                      aria-label={`Edit answer for ${field.title || startCase(name)}`}
                      onClick={() => {
                        setFromReview(true);
                        setStep(index);
                      }}
                    >
                      Edit
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      <div className={requestActionsClass}>
        <button
          // A fresh node per phase, so a quick second click on "Review" cannot land on "Submit".
          key={carousel ? (reviewing ? "submit" : "next") : "continue"}
          type="submit"
          className={cn(primaryRequestButtonClass, carousel && "min-w-20")}
          // Ignore the repeat of a double-click or a held Enter; it would skip a question or the review.
          onClick={(event) => carousel && event.detail > 1 && event.preventDefault()}
          onKeyDown={(event) => carousel && event.repeat && event.preventDefault()}
        >
          {carousel
            ? reviewing
              ? "Submit"
              : step === fields.length - 1 || fromReview
                ? "Review"
                : "Next"
            : questions
              ? "Continue"
              : "Submit"}
        </button>
        {carousel && (
          <button type="button" className={requestButtonClass} disabled={step === 0} onClick={() => go(step - 1)}>
            Back
          </button>
        )}
        <button type="button" className={requestButtonClass} onClick={() => onResolve({ action: "decline" })}>
          {carousel ? "Skip all" : questions ? "Skip" : "Decline"}
        </button>
        {!questions && (
          <button type="button" className={quietRequestButtonClass} onClick={() => onResolve({ action: "cancel" })}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function ElicitationField({
  id,
  label,
  schema,
  presentation,
  question,
  required,
  value,
  error,
  onChange,
  onPick,
}: {
  id: string;
  label: string;
  schema: ElicitationPrimitiveSchema;
  presentation?: QuestionPresentation;
  question: boolean;
  required: boolean;
  value: ElicitationDraftValue;
  error?: string;
  onChange: (value: ElicitationDraftValue) => void;
  /** Called after a single option is clicked or tapped (never for keys, typed text or multi-select). */
  onPick?: () => void;
}) {
  const describedBy =
    [schema.description && `${id}-description`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  const validation = {
    "aria-invalid": !!error,
    "aria-describedby": describedBy,
    "aria-errormessage": error ? `${id}-error` : undefined,
  } as const;
  const boolean = isBooleanSchema(schema);
  const multiple = isMultiSelectSchema(schema);
  const options = boolean
    ? [
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ]
    : (presentation?.options ??
      (multiple
        ? getMultiSelectOptions(schema)
        : isSingleSelectSchema(schema)
          ? getSingleSelectOptions(schema)
          : undefined));
  const title = (
    <>
      {label}
      {!required && <span className="ml-2 text-xs font-normal text-neutral-400 dark:text-neutral-500">Optional</span>}
    </>
  );
  const description = schema.description && (
    <p id={`${id}-description`} className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
      {schema.description}
    </p>
  );
  const errorMessage = error && (
    <p id={`${id}-error`} role="alert" className="text-xs text-red-600 dark:text-red-400">
      {error}
    </p>
  );
  if (options) {
    return (
      <fieldset className="min-w-0 space-y-2" aria-label={label}>
        <legend className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-200">{title}</legend>
        {description}
        <QuestionChoices
          id={id}
          label={label}
          options={options}
          multiple={multiple}
          horizontal={boolean}
          allowOther={presentation?.allowOther ?? false}
          compact={!question && !boolean && options.length > 5}
          required={required}
          value={boolean ? (typeof value === "boolean" ? String(value) : "") : value}
          onChange={(next) => onChange(boolean ? (next === "" ? undefined : next === "true") : next)}
          onPick={onPick}
          validation={validation}
        />
        {errorMessage}
      </fieldset>
    );
  }
  const attributes = {
    id,
    "aria-label": label,
    "aria-required": required,
    ...validation,
    value: typeof value === "string" ? value : "",
    className: cn(inputClass, "focus-visible:outline-none"),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  };
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={id} className={cn(fieldLabelClass, "block text-sm text-neutral-800 dark:text-neutral-200")}>
        {title}
      </label>
      {description}
      {question && isStringSchema(schema) && !schema.format ? (
        <textarea
          {...attributes}
          rows={2}
          className={cn(attributes.className, "resize-y")}
          placeholder="Write your answer…"
        />
      ) : (
        <input
          {...attributes}
          type={getInputType(schema)}
          min={isNumberSchema(schema) ? schema.minimum : undefined}
          max={isNumberSchema(schema) ? schema.maximum : undefined}
          minLength={isStringSchema(schema) ? schema.minLength : undefined}
          maxLength={isStringSchema(schema) ? schema.maxLength : undefined}
          step={schema.type === "integer" ? "1" : "any"}
        />
      )}
      {errorMessage}
    </div>
  );
}

function QuestionChoices({
  id,
  label,
  options,
  multiple,
  horizontal,
  allowOther,
  compact,
  required,
  value,
  onChange,
  onPick,
  validation,
}: {
  id: string;
  label: string;
  options: QuestionChoice[];
  multiple: boolean;
  horizontal: boolean;
  allowOther: boolean;
  compact: boolean;
  required: boolean;
  value: ElicitationDraftValue;
  onChange: (value: ElicitationDraftValue) => void;
  onPick?: () => void;
  validation: { "aria-invalid": boolean; "aria-describedby"?: string; "aria-errormessage"?: string };
}) {
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");
  // Only a real mouse/touch press may auto-advance: arrow keys also "select" a radio, and
  // advancing then would hide the group before the later options can be reached.
  const pressed = useRef(false);
  const selected = Array.isArray(value) ? value.filter((v) => options.some((option) => option.value === v)) : [];
  const combine = (selected: string[], custom: string) => [
    ...new Set([...selected, ...(custom.trim() ? [custom.trim()] : [])]),
  ];
  const answered = multiple ? Array.isArray(value) && value.length > 0 : value !== undefined && value !== "";
  return (
    <div className="min-w-0 space-y-2">
      {compact && !multiple ? (
        <select
          id={id}
          aria-label={label}
          aria-required={required}
          {...validation}
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select an option</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <div
          className={cn("grid gap-2", horizontal && "grid-cols-2")}
          onMouseDown={(event) => (pressed.current = event.detail === 1)}
          onKeyDown={() => (pressed.current = false)}
        >
          {options.map((option, index) => (
            <ChoiceControl
              key={option.value}
              chip
              type={multiple ? "checkbox" : "radio"}
              name={id}
              value={option.value}
              aria-label={option.label}
              {...validation}
              aria-describedby={
                [validation["aria-describedby"], option.description && `${id}-option-${index}`]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              aria-required={!multiple && required}
              onClick={(event) => {
                if (onPick && event.detail > 1) {
                  event.preventDefault();
                  return;
                }
                // Also fires for a re-click on the selected option, which has no change event.
                if (!multiple && pressed.current) onPick?.();
                pressed.current = false;
              }}
              checked={multiple ? selected.includes(option.value) : !customMode && value === option.value}
              className="w-full items-start has-focus-visible:ring-2 has-focus-visible:ring-neutral-400/40 [&>input]:mt-0.5"
              onChange={(event) => {
                // React also queues change for a cancelled radio/checkbox click.
                if (event.nativeEvent.defaultPrevented) return;
                if (multiple)
                  onChange(
                    combine(
                      event.target.checked ? [...selected, option.value] : selected.filter((v) => v !== option.value),
                      customText,
                    ),
                  );
                else {
                  setCustomMode(false);
                  setCustomText("");
                  onChange(option.value);
                }
              }}
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{option.label}</span>
                {option.recommended && (
                  <span className="rounded bg-neutral-200/70 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                    Recommended
                  </span>
                )}
              </span>
              {option.description && (
                <span
                  id={`${id}-option-${index}`}
                  className="mt-0.5 block text-xs leading-5 text-neutral-500 dark:text-neutral-400"
                >
                  {option.description}
                </span>
              )}
            </ChoiceControl>
          ))}
        </div>
      )}
      {allowOther && (
        <div className="pt-1">
          <label htmlFor={`${id}-custom`} className={cn(fieldLabelClass, "mb-1 block")}>
            {multiple ? "Anything else?" : "Or write your own answer"}
          </label>
          <textarea
            id={`${id}-custom`}
            aria-label={`Your answer for ${label}`}
            {...validation}
            rows={2}
            placeholder="Write an answer…"
            value={customText}
            className={cn(inputClass, "resize-y focus-visible:outline-none")}
            onChange={(event) => {
              setCustomText(event.target.value);
              setCustomMode(true);
              onChange(multiple ? combine(selected, event.target.value) : event.target.value);
            }}
          />
        </div>
      )}
      {answered && (
        <button
          type="button"
          className={quietButton}
          aria-label={`Clear answer for ${label}`}
          onClick={() => {
            setCustomText("");
            setCustomMode(false);
            onChange(multiple ? [] : "");
          }}
        >
          Clear answer
        </button>
      )}
    </div>
  );
}
