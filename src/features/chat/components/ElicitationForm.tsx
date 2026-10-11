import { useEffect, useId, useRef, useState } from "react";
import { HelpCircle, Send } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { getToolDisplayName } from "@/shared/lib/utils";
import { Markdown } from "@/shared/ui/Markdown";
import { ChoiceControl } from "@/shared/ui/forms/ChoiceControl";
import { buttonClass, fieldLabelClass, inputClass, primaryButtonClass } from "@/shared/ui/forms/controlStyles";
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
  useEffect(() => {
    if (focusError.current) {
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      focusError.current = false;
    }
  }, [errors]);
  return (
    <form
      ref={form}
      noValidate
      aria-labelledby={`${id}-title`}
      className="my-2 min-w-0 max-w-xl rounded-xl border border-neutral-200 bg-white p-4 text-sm shadow-xs sm:p-5 dark:border-neutral-800 dark:bg-neutral-900/50"
      onSubmit={(event) => {
        event.preventDefault();
        const result = validateElicitationForm(schema, values);
        focusError.current = !!result.errors;
        setErrors(result.errors ?? {});
        if (!result.errors) onResolve({ action: "accept", content: result.content });
      }}
    >
      <div className="mb-5 flex items-start gap-2.5">
        <HelpCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
        <div className="min-w-0 space-y-1">
          <h3 id={`${id}-title`} className="font-medium text-neutral-900 dark:text-neutral-100">
            {questions
              ? fields.length === 1
                ? "A quick question"
                : "A few quick questions"
              : getToolDisplayName(toolName)}
          </h3>
          {elicitation.message && (
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              <Markdown compact>{elicitation.message}</Markdown>
            </div>
          )}
        </div>
      </div>
      <div className="space-y-5">
        {fields.map(([name, field], index) => (
          <ElicitationField
            key={name}
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
              setErrors((current) => {
                if (!Object.hasOwn(current, name)) return current;
                const next = { ...current };
                delete next[name];
                return next;
              });
            }}
          />
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-neutral-200/70 pt-4 dark:border-neutral-800">
        <button type="submit" className={cn(buttonClass, primaryButtonClass, "inline-flex items-center gap-2")}>
          <Send aria-hidden="true" className="size-3.5" />
          {questions ? "Continue" : "Submit"}
        </button>
        <button type="button" className={quietButton} onClick={() => onResolve({ action: "decline" })}>
          {questions ? "Skip" : "Decline"}
        </button>
        {!questions && (
          <button type="button" className={quietButton} onClick={() => onResolve({ action: "cancel" })}>
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
  validation: { "aria-invalid": boolean; "aria-describedby"?: string; "aria-errormessage"?: string };
}) {
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");
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
        <div className={cn("grid gap-2", horizontal && "grid-cols-2")}>
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
              checked={multiple ? selected.includes(option.value) : !customMode && value === option.value}
              className="w-full items-start has-focus-visible:ring-2 has-focus-visible:ring-neutral-400/40 [&>input]:mt-0.5"
              onChange={(event) => {
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
