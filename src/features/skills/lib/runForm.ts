import { z } from "zod";
import type { ParsedSkill } from "./skillParser";

export const RUN_FORM_PATH = "run-form.json";
const label = z.string().trim().min(1).max(200);
const base = {
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(64),
  label,
  required: z.boolean().default(false),
};
const fieldSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...base,
    type: z.literal("text"),
    placeholder: label.optional(),
    default: z.string().max(50000).optional(),
    rows: z.number().int().min(2).max(8).optional(),
    maxLength: z.number().int().min(1).max(50000).optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("select"),
    options: z.array(label).min(1).max(30),
    default: label.optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("file"),
    accept: z
      .array(z.string().regex(/^\.[a-z0-9]+$/))
      .min(1)
      .max(20),
  }),
]);
const schema = z
  .strictObject({
    version: z.literal(1),
    title: label,
    description: z.string().trim().min(1).max(1000),
    example: z.string().trim().min(1).max(4000),
    fields: z.array(fieldSchema).min(1).max(12),
    /** For inputs such as pasted notes OR an uploaded transcript. */
    atLeastOneOf: z.array(z.string()).min(2).max(12).optional(),
  })
  .superRefine((form, ctx) => {
    const ids = new Set<string>();
    for (const field of form.fields) {
      if (ids.has(field.id)) ctx.addIssue({ code: "custom", message: `Duplicate field: ${field.id}` });
      ids.add(field.id);
      if (field.type === "select" && field.default !== undefined && !field.options.includes(field.default)) {
        ctx.addIssue({ code: "custom", message: `Invalid default for ${field.label}` });
      }
      if (field.type === "text" && (field.default?.length ?? 0) > (field.maxLength ?? 4000)) {
        ctx.addIssue({ code: "custom", message: `Default is too long for ${field.label}` });
      }
    }
    if (
      form.atLeastOneOf?.some((id) => !ids.has(id)) ||
      new Set(form.atLeastOneOf).size !== (form.atLeastOneOf?.length ?? 0)
    ) {
      ctx.addIssue({ code: "custom", message: "atLeastOneOf must reference distinct existing fields" });
    }
  });

export type RunForm = z.infer<typeof schema>;
export interface SkillWorkflow {
  name: string;
  form: RunForm;
  /** Built-in skills do not appear in the composer's personal skill picker. */
  personal: boolean;
}
export type RunValues = Record<string, string>;
export type RunFiles = Record<string, File | undefined>;

export function parseRunForm(content: string): RunForm {
  return schema.parse(JSON.parse(content));
}

export function skillRunForm(skill: ParsedSkill): RunForm | null {
  const resource = skill.resources?.find((entry) => entry.path === RUN_FORM_PATH);
  return resource ? parseRunForm(resource.content) : null;
}

export function defaultRunValues(form: RunForm): RunValues {
  return Object.fromEntries(
    form.fields.filter((field) => field.type !== "file").map((field) => [field.id, field.default ?? ""]),
  );
}

/** Validate before creating a chat; slot prefixes keep same-named versions distinct. */
export function prepareSkillRun(workflow: SkillWorkflow, values: RunValues, files: RunFiles, maxFileSize?: number) {
  const inputs: Record<string, { label: string; value: string }> = {};
  const uploads: File[] = [];
  for (const field of workflow.form.fields) {
    if (field.type === "file") {
      const file = files[field.id];
      if (!file) {
        if (field.required) throw new Error(`Choose a file for ${field.label}.`);
        continue;
      }
      if (!field.accept.some((extension) => file.name.toLowerCase().endsWith(extension))) {
        throw new Error(`${field.label} accepts ${field.accept.join(", ")}.`);
      }
      if (!file.size) throw new Error(`${field.label} is empty. Choose a document with content.`);
      if (maxFileSize !== undefined && file.size > maxFileSize)
        throw new Error(`${field.label} exceeds the upload size limit.`);
      // Control characters and separators must not become workspace path syntax.
      // eslint-disable-next-line no-control-regex
      const name = `${field.id}-${file.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_")}`;
      uploads.push(new File([file], name, { type: file.type, lastModified: file.lastModified }));
      inputs[field.id] = { label: field.label, value: `/${name}` };
    } else {
      const value = (values[field.id] ?? "").trim();
      if (field.required && !value) throw new Error(`Enter ${field.label}.`);
      if (value.length > (field.type === "text" ? (field.maxLength ?? 4000) : 4000))
        throw new Error(`${field.label} is too long.`);
      if (field.type === "select" && value && !field.options.includes(value))
        throw new Error(`Choose an option for ${field.label}.`);
      if (value) inputs[field.id] = { label: field.label, value };
    }
  }
  if (workflow.form.atLeastOneOf && !workflow.form.atLeastOneOf.some((id) => inputs[id])) {
    const names = workflow.form.fields
      .filter((field) => workflow.form.atLeastOneOf!.includes(field.id))
      .map((field) => field.label);
    throw new Error(`Provide at least one of: ${names.join(" or ")}.`);
  }
  const content = `${workflow.form.title}\n\n${Object.values(inputs)
    .map(({ label, value }) => `**${label}**\n${value}`)
    .join("\n\n")}`;
  return { content, uploads };
}
