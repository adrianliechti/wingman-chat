import type {
  ElicitationBooleanSchema,
  ElicitationMultiSelectSchema,
  ElicitationNumberSchema,
  ElicitationPrimitiveSchema,
  ElicitationSchema,
  ElicitationSingleSelectSchema,
  ElicitationStringSchema,
  ElicitationValue,
} from "@/shared/types/elicitation";

export type ElicitationDraftValue = string | boolean | string[] | undefined;

export function buildInitialElicitationValues(schema?: ElicitationSchema): Record<string, ElicitationDraftValue> {
  if (!schema) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(schema.properties).map(([name, fieldSchema]) => {
      if (isMultiSelectSchema(fieldSchema)) {
        return [name, fieldSchema.default ?? []];
      }

      if (isBooleanSchema(fieldSchema)) {
        return [name, fieldSchema.default];
      }

      if (isNumberSchema(fieldSchema)) {
        return [name, fieldSchema.default !== undefined ? String(fieldSchema.default) : ""];
      }

      return [name, fieldSchema.default ?? ""];
    }),
  );
}

export function validateElicitationForm(
  schema: ElicitationSchema,
  values: Record<string, ElicitationDraftValue>,
): {
  content?: Record<string, ElicitationValue>;
  errors?: Record<string, string>;
} {
  const errors: Record<string, string> = Object.create(null);
  const content: Record<string, ElicitationValue> = Object.create(null);
  const required = new Set(schema.required ?? []);

  for (const [name, fieldSchema] of Object.entries(schema.properties)) {
    const rawValue = values[name];

    if (isMultiSelectSchema(fieldSchema)) {
      const selected = Array.isArray(rawValue) ? rawValue : [];

      if (required.has(name) && selected.length === 0) {
        errors[name] = "Select at least one option.";
        continue;
      }

      if (selected.length === 0 && !required.has(name)) continue;

      const options = getMultiSelectOptions(fieldSchema);
      if (
        ((fieldSchema.items.enum !== undefined || fieldSchema.items.anyOf !== undefined) &&
          selected.some((value) => !options.some((option) => option.value === value))) ||
        new Set(selected).size !== selected.length
      ) {
        errors[name] = "Choose valid, distinct options.";
        continue;
      }

      if (fieldSchema.minItems !== undefined && selected.length < fieldSchema.minItems) {
        errors[name] = `Select at least ${fieldSchema.minItems} option${fieldSchema.minItems === 1 ? "" : "s"}.`;
        continue;
      }

      if (fieldSchema.maxItems !== undefined && selected.length > fieldSchema.maxItems) {
        errors[name] = `Select no more than ${fieldSchema.maxItems} option${fieldSchema.maxItems === 1 ? "" : "s"}.`;
        continue;
      }

      if (selected.length > 0 || required.has(name)) {
        content[name] = selected;
      }

      continue;
    }

    if (isBooleanSchema(fieldSchema)) {
      if (typeof rawValue === "boolean") content[name] = rawValue;
      else if (required.has(name)) errors[name] = "Choose Yes or No.";
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

      if (!Number.isFinite(numberValue)) {
        errors[name] = "Enter a valid number.";
        continue;
      }

      if (fieldSchema.type === "integer" && !Number.isInteger(numberValue)) {
        errors[name] = "Enter a whole number.";
        continue;
      }

      if (fieldSchema.minimum !== undefined && numberValue < fieldSchema.minimum) {
        errors[name] = `Enter a value greater than or equal to ${fieldSchema.minimum}.`;
        continue;
      }

      if (fieldSchema.maximum !== undefined && numberValue > fieldSchema.maximum) {
        errors[name] = `Enter a value less than or equal to ${fieldSchema.maximum}.`;
        continue;
      }

      content[name] = numberValue;
      continue;
    }

    if (
      isSingleSelectSchema(fieldSchema) &&
      !getSingleSelectOptions(fieldSchema).some((option) => option.value === stringValue)
    ) {
      errors[name] = "Choose one of the available options.";
      continue;
    }

    if (isStringSchema(fieldSchema)) {
      if (fieldSchema.minLength !== undefined && stringValue.length < fieldSchema.minLength) {
        errors[name] = `Enter at least ${fieldSchema.minLength} characters.`;
        continue;
      }

      if (fieldSchema.maxLength !== undefined && stringValue.length > fieldSchema.maxLength) {
        errors[name] = `Enter no more than ${fieldSchema.maxLength} characters.`;
        continue;
      }

      if (fieldSchema.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue)) {
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

export function getInputType(schema: ElicitationPrimitiveSchema): string {
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

export function isNumberSchema(schema: ElicitationPrimitiveSchema): schema is ElicitationNumberSchema {
  return schema.type === "number" || schema.type === "integer";
}

export function isBooleanSchema(schema: ElicitationPrimitiveSchema): schema is ElicitationBooleanSchema {
  return schema.type === "boolean";
}

export function isMultiSelectSchema(schema: ElicitationPrimitiveSchema): schema is ElicitationMultiSelectSchema {
  return schema.type === "array";
}

export function isSingleSelectSchema(schema: ElicitationPrimitiveSchema): schema is ElicitationSingleSelectSchema {
  return schema.type === "string" && ("enum" in schema || "oneOf" in schema);
}

export function isStringSchema(schema: ElicitationPrimitiveSchema): schema is ElicitationStringSchema {
  return schema.type === "string" && !("enum" in schema) && !("oneOf" in schema);
}

export function getSingleSelectOptions(schema: ElicitationSingleSelectSchema): Array<{ value: string; label: string }> {
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

export function getMultiSelectOptions(schema: ElicitationMultiSelectSchema): Array<{ value: string; label: string }> {
  if (schema.items.anyOf) {
    return schema.items.anyOf.map((option) => ({
      value: option.const,
      label: option.title,
    }));
  }

  return (schema.items.enum ?? []).map((value) => ({ value, label: value }));
}

export function startCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
