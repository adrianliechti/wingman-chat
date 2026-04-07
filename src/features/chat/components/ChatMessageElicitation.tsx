import { Check, ShieldQuestion, X } from "lucide-react";
import { useState } from "react";

import type {
  Elicitation,
  ElicitationBooleanSchema,
  ElicitationMultiSelectSchema,
  ElicitationNumberSchema,
  ElicitationPrimitiveSchema,
  ElicitationResult,
  ElicitationSchema,
  ElicitationSingleSelectSchema,
  ElicitationStringSchema,
  ElicitationValue,
} from "@/shared/types/elicitation";

type ChatMessageElicitationProps = {
  toolName: string;
  elicitation: Elicitation;
  onResolve: (result: ElicitationResult) => void;
};

type ElicitationDraftValue = string | boolean | string[];

export function ChatMessageElicitation({
  toolName,
  elicitation,
  onResolve,
}: ChatMessageElicitationProps) {
  const requestedSchema = elicitation.requestedSchema;
  const isMinimalConfirmation =
    !requestedSchema || Object.keys(requestedSchema.properties).length === 0;
  const [formValues, setFormValues] = useState<
    Record<string, ElicitationDraftValue>
  >(() => buildInitialElicitationValues(requestedSchema));
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (isMinimalConfirmation) {
    return (
      <div className="rounded-lg overflow-hidden max-w-full">
        <div className="flex items-start gap-2 min-w-0">
          <ShieldQuestion className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="text-xs text-neutral-500 dark:text-neutral-400 whitespace-pre-wrap">
              {elicitation.message}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onResolve({ action: "accept", content: {} })}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-300 transition-colors"
              >
                <Check className="w-3 h-3" />
                Approve
              </button>
              <button
                type="button"
                onClick={() => onResolve({ action: "decline" })}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-300 transition-colors"
              >
                <X className="w-3 h-3" />
                Decline
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validation = validateElicitationForm(requestedSchema, formValues);
    if (validation.errors && Object.keys(validation.errors).length > 0) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    onResolve({
      action: "accept",
      ...(validation.content ? { content: validation.content } : {}),
    });
  };

  const setFieldValue = (name: string, value: ElicitationDraftValue) => {
    setFormValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!current[name]) {
        return current;
      }

      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  return (
    <div className="rounded-lg overflow-hidden max-w-full">
      <div className="flex items-start gap-2 min-w-0">
        <ShieldQuestion className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="mb-1">
            <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {getToolDisplayName(toolName)}
            </span>
            <div className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
              {elicitation.message}
            </div>
          </div>
          <form className="mt-2 space-y-3" onSubmit={handleSubmit}>
            {requestedSchema && (
              <div className="space-y-3 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-950/30 p-3">
                {Object.entries(requestedSchema.properties).map(
                  ([name, fieldSchema]) => {
                    const fieldId = `elicitation-${toolName}-${name}`;
                    const required =
                      requestedSchema.required?.includes(name) ?? false;
                    const label = fieldSchema.title || startCase(name);
                    const description = fieldSchema.description;
                    const error = errors[name];

                    if (isMultiSelectSchema(fieldSchema)) {
                      const selected = Array.isArray(formValues[name])
                        ? (formValues[name] as string[])
                        : [];
                      const options = getMultiSelectOptions(fieldSchema);

                      return (
                        <fieldset key={name} className="space-y-2 min-w-0">
                          <legend className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                            {label}
                            {required ? " *" : ""}
                          </legend>
                          {description && (
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                              {description}
                            </p>
                          )}
                          <div className="space-y-2">
                            {options.map((option) => (
                              <label
                                key={option.value}
                                className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300"
                              >
                                <input
                                  type="checkbox"
                                  className="rounded border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                                  checked={selected.includes(option.value)}
                                  onChange={(event) => {
                                    const next = event.target.checked
                                      ? [...selected, option.value]
                                      : selected.filter(
                                          (value) => value !== option.value,
                                        );
                                    setFieldValue(name, next);
                                  }}
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                          {error && (
                            <p className="text-xs text-red-500 dark:text-red-400">
                              {error}
                            </p>
                          )}
                        </fieldset>
                      );
                    }

                    if (isBooleanSchema(fieldSchema)) {
                      return (
                        <div key={name} className="space-y-2 min-w-0">
                          <label
                            htmlFor={fieldId}
                            className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300"
                          >
                            <input
                              id={fieldId}
                              type="checkbox"
                              className="rounded border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                              checked={!!formValues[name]}
                              onChange={(event) =>
                                setFieldValue(name, event.target.checked)
                              }
                            />
                            <span className="font-medium">
                              {label}
                              {required ? " *" : ""}
                            </span>
                          </label>
                          {description && (
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                              {description}
                            </p>
                          )}
                          {error && (
                            <p className="text-xs text-red-500 dark:text-red-400">
                              {error}
                            </p>
                          )}
                        </div>
                      );
                    }

                    if (isSingleSelectSchema(fieldSchema)) {
                      const options = getSingleSelectOptions(fieldSchema);
                      const value =
                        typeof formValues[name] === "string"
                          ? formValues[name]
                          : "";

                      return (
                        <div key={name} className="space-y-2 min-w-0">
                          <label
                            htmlFor={fieldId}
                            className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
                          >
                            {label}
                            {required ? " *" : ""}
                          </label>
                          {description && (
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                              {description}
                            </p>
                          )}
                          <select
                            id={fieldId}
                            className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
                            value={value}
                            onChange={(event) =>
                              setFieldValue(name, event.target.value)
                            }
                          >
                            <option value="">Select an option</option>
                            {options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          {error && (
                            <p className="text-xs text-red-500 dark:text-red-400">
                              {error}
                            </p>
                          )}
                        </div>
                      );
                    }

                    const inputType = getInputType(fieldSchema);
                    const value =
                      typeof formValues[name] === "string"
                        ? formValues[name]
                        : "";

                    return (
                      <div key={name} className="space-y-2 min-w-0">
                        <label
                          htmlFor={fieldId}
                          className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
                        >
                          {label}
                          {required ? " *" : ""}
                        </label>
                        {description && (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            {description}
                          </p>
                        )}
                        <input
                          id={fieldId}
                          type={inputType}
                          value={value}
                          min={
                            isNumberSchema(fieldSchema)
                              ? fieldSchema.minimum
                              : undefined
                          }
                          max={
                            isNumberSchema(fieldSchema)
                              ? fieldSchema.maximum
                              : undefined
                          }
                          minLength={
                            isStringSchema(fieldSchema)
                              ? fieldSchema.minLength
                              : undefined
                          }
                          maxLength={
                            isStringSchema(fieldSchema)
                              ? fieldSchema.maxLength
                              : undefined
                          }
                          step={
                            fieldSchema.type === "integer" ? "1" : undefined
                          }
                          className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
                          onChange={(event) =>
                            setFieldValue(name, event.target.value)
                          }
                        />
                        {error && (
                          <p className="text-xs text-red-500 dark:text-red-400">
                            {error}
                          </p>
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-300 transition-colors"
              >
                <Check className="w-3 h-3" />
                Submit
              </button>
              <button
                type="button"
                onClick={() => onResolve({ action: "decline" })}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-300 transition-colors"
              >
                <X className="w-3 h-3" />
                Decline
              </button>
              <button
                type="button"
                onClick={() => onResolve({ action: "cancel" })}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function getToolDisplayName(toolName: string): string {
  return toolName
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildInitialElicitationValues(
  schema?: ElicitationSchema,
): Record<string, ElicitationDraftValue> {
  if (!schema) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(schema.properties).map(([name, fieldSchema]) => {
      if (isMultiSelectSchema(fieldSchema)) {
        return [name, fieldSchema.default ?? []];
      }

      if (isBooleanSchema(fieldSchema)) {
        return [name, fieldSchema.default ?? false];
      }

      if (isNumberSchema(fieldSchema)) {
        return [
          name,
          fieldSchema.default !== undefined ? String(fieldSchema.default) : "",
        ];
      }

      return [name, fieldSchema.default ?? ""];
    }),
  );
}

function validateElicitationForm(
  schema: ElicitationSchema,
  values: Record<string, ElicitationDraftValue>,
): {
  content?: Record<string, ElicitationValue>;
  errors?: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const content: Record<string, ElicitationValue> = {};
  const required = new Set(schema.required ?? []);

  for (const [name, fieldSchema] of Object.entries(schema.properties)) {
    const rawValue = values[name];

    if (isMultiSelectSchema(fieldSchema)) {
      const selected = Array.isArray(rawValue) ? rawValue : [];

      if (required.has(name) && selected.length === 0) {
        errors[name] = "Select at least one option.";
        continue;
      }

      if (
        fieldSchema.minItems !== undefined &&
        selected.length < fieldSchema.minItems
      ) {
        errors[name] =
          `Select at least ${fieldSchema.minItems} option${fieldSchema.minItems === 1 ? "" : "s"}.`;
        continue;
      }

      if (
        fieldSchema.maxItems !== undefined &&
        selected.length > fieldSchema.maxItems
      ) {
        errors[name] =
          `Select no more than ${fieldSchema.maxItems} option${fieldSchema.maxItems === 1 ? "" : "s"}.`;
        continue;
      }

      if (selected.length > 0 || required.has(name)) {
        content[name] = selected;
      }

      continue;
    }

    if (isBooleanSchema(fieldSchema)) {
      content[name] = !!rawValue;
      continue;
    }

    const stringValue = typeof rawValue === "string" ? rawValue.trim() : "";

    if (!stringValue) {
      if (required.has(name)) {
        errors[name] = "This field is required.";
      }
      continue;
    }

    if (isNumberSchema(fieldSchema)) {
      const numberValue = Number(stringValue);

      if (Number.isNaN(numberValue)) {
        errors[name] = "Enter a valid number.";
        continue;
      }

      if (fieldSchema.type === "integer" && !Number.isInteger(numberValue)) {
        errors[name] = "Enter a whole number.";
        continue;
      }

      if (
        fieldSchema.minimum !== undefined &&
        numberValue < fieldSchema.minimum
      ) {
        errors[name] =
          `Enter a value greater than or equal to ${fieldSchema.minimum}.`;
        continue;
      }

      if (
        fieldSchema.maximum !== undefined &&
        numberValue > fieldSchema.maximum
      ) {
        errors[name] =
          `Enter a value less than or equal to ${fieldSchema.maximum}.`;
        continue;
      }

      content[name] = numberValue;
      continue;
    }

    if (isStringSchema(fieldSchema)) {
      if (
        fieldSchema.minLength !== undefined &&
        stringValue.length < fieldSchema.minLength
      ) {
        errors[name] = `Enter at least ${fieldSchema.minLength} characters.`;
        continue;
      }

      if (
        fieldSchema.maxLength !== undefined &&
        stringValue.length > fieldSchema.maxLength
      ) {
        errors[name] =
          `Enter no more than ${fieldSchema.maxLength} characters.`;
        continue;
      }

      if (
        fieldSchema.format === "email" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue)
      ) {
        errors[name] = "Enter a valid email address.";
        continue;
      }

      if (fieldSchema.format === "uri") {
        try {
          new URL(stringValue);
        } catch {
          errors[name] = "Enter a valid URL.";
          continue;
        }
      }

      if (
        (fieldSchema.format === "date" || fieldSchema.format === "date-time") &&
        Number.isNaN(Date.parse(stringValue))
      ) {
        errors[name] = "Enter a valid date.";
        continue;
      }
    }

    content[name] = stringValue;
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return { content };
}

function getInputType(schema: ElicitationPrimitiveSchema): string {
  if (isNumberSchema(schema)) {
    return "number";
  }

  if (!isStringSchema(schema)) {
    return "text";
  }

  switch (schema.format) {
    case "email":
      return "email";
    case "date":
      return "date";
    case "date-time":
      return "datetime-local";
    case "uri":
      return "url";
    default:
      return "text";
  }
}

function isNumberSchema(
  schema: ElicitationPrimitiveSchema,
): schema is ElicitationNumberSchema {
  return schema.type === "number" || schema.type === "integer";
}

function isBooleanSchema(
  schema: ElicitationPrimitiveSchema,
): schema is ElicitationBooleanSchema {
  return schema.type === "boolean";
}

function isMultiSelectSchema(
  schema: ElicitationPrimitiveSchema,
): schema is ElicitationMultiSelectSchema {
  return schema.type === "array";
}

function isSingleSelectSchema(
  schema: ElicitationPrimitiveSchema,
): schema is ElicitationSingleSelectSchema {
  return schema.type === "string" && ("enum" in schema || "oneOf" in schema);
}

function isStringSchema(
  schema: ElicitationPrimitiveSchema,
): schema is ElicitationStringSchema {
  return (
    schema.type === "string" && !("enum" in schema) && !("oneOf" in schema)
  );
}

function getSingleSelectOptions(
  schema: ElicitationSingleSelectSchema,
): Array<{ value: string; label: string }> {
  if (schema.oneOf) {
    return schema.oneOf.map((option) => ({
      value: option.const,
      label: option.title,
    }));
  }

  if (schema.enum) {
    return schema.enum.map((value, index) => ({
      value,
      label: schema.enumNames?.[index] ?? value,
    }));
  }

  return [];
}

function getMultiSelectOptions(
  schema: ElicitationMultiSelectSchema,
): Array<{ value: string; label: string }> {
  if (schema.items.anyOf) {
    return schema.items.anyOf.map((option) => ({
      value: option.const,
      label: option.title,
    }));
  }

  return (schema.items.enum ?? []).map((value) => ({ value, label: value }));
}

function startCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
