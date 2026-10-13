import { z } from "zod";
import { MCPInputRequiredError } from "@tanstack/ai-mcp";
import { HelpCircle } from "lucide-react";
import type { ContentPart } from "@tanstack/ai";
import type { Tool, ToolContext } from "@/shared/types/chat";
import type {
  ElicitationPrimitiveSchema,
  ElicitationResult,
  ElicitationValue,
  FormElicitation,
  QuestionPresentation,
} from "@/shared/types/elicitation";
import { outputText } from "@/shared/lib/messages";
import { toolPreviewList } from "@/shared/lib/toolPreview";
import { validateElicitationForm } from "./elicitationForm";

export const questionsInputSchema = z
  .strictObject({
    message: z.string().describe("Optional short explanation of why the answers matter.").optional(),
    questions: z
      .array(
        z.strictObject({
          id: z.string().trim().min(1).describe('Unique answer key, e.g. "audience".'),
          label: z.string().trim().min(1).describe("A concise, self-contained question."),
          description: z.string().describe("Optional helper text about the decision or tradeoff.").optional(),
          type: z
            .enum(["text", "number", "boolean", "select", "multi_select"])
            .describe(
              "Use select for one choice, multi_select for several, boolean for an explicit Yes/No, or text/number for free entry.",
            ),
          options: z
            .array(
              z.strictObject({
                value: z.string().trim().min(1),
                label: z.string().trim().min(1),
                description: z.string().describe("Briefly explain the impact or tradeoff of this option.").optional(),
                recommended: z
                  .boolean()
                  .describe(
                    "Marks a recommendation without selecting it. Put it first; use at most one for a single-choice question.",
                  )
                  .optional(),
              }),
            )
            .describe(
              "Required for choice questions. Prefer 2–4 distinct options; do not add an Other option—the form provides written answers.",
            )
            .optional(),
          allow_other: z
            .boolean()
            .describe(
              "Choice questions allow a written answer by default. Set false only when a fixed set of values is necessary.",
            )
            .optional(),
          required: z
            .boolean()
            .describe("Defaults to false. Require an answer only when the task cannot proceed without it.")
            .optional(),
        }),
      )
      .min(1)
      .max(3)
      .describe("Ask 1–3 related questions together, preferably just one."),
  })
  .superRefine(({ questions }, ctx) => {
    const ids = new Set<string>();
    questions.forEach((q, index) => {
      const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["questions", index], message });
      if (ids.has(q.id)) issue(`Duplicate question id: ${q.id}.`);
      ids.add(q.id);
      const choice = q.type === "select" || q.type === "multi_select";
      if (choice && !q.options?.length) issue(`Question ${q.id} needs at least one option.`);
      if (!choice && (q.options !== undefined || q.allow_other !== undefined))
        issue("Only choice questions accept options or allow_other.");
      if (q.options && new Set(q.options.map((option) => option.value)).size !== q.options.length)
        issue("Use unique option values.");
      if (q.type === "select" && (q.options?.filter((option) => option.recommended).length ?? 0) > 1)
        issue("Recommend at most one option for a single-choice question.");
    });
  });

type QuestionsInput = z.infer<typeof questionsInputSchema>;

export function questionRequest(input: QuestionsInput): FormElicitation {
  const properties: Record<string, ElicitationPrimitiveSchema> = Object.create(null);
  const fields: Record<string, QuestionPresentation> = Object.create(null);
  const required: string[] = [];
  for (const q of input.questions) {
    const common = { title: q.label, ...(q.description ? { description: q.description } : {}) };
    const allowOther = q.allow_other !== false;
    const options = q.options?.map((option) => ({ const: option.value, title: option.label })) ?? [];
    switch (q.type) {
      case "boolean":
        properties[q.id] = { ...common, type: "boolean" };
        break;
      case "number":
        properties[q.id] = { ...common, type: "number" };
        break;
      case "select":
        properties[q.id] = { ...common, type: "string", ...(!allowOther && { oneOf: options }) };
        fields[q.id] = { options: q.options, allowOther };
        break;
      case "multi_select":
        properties[q.id] = { ...common, type: "array", items: allowOther ? { type: "string" } : { anyOf: options } };
        fields[q.id] = { options: q.options, allowOther };
        break;
      default:
        properties[q.id] = { ...common, type: "string" };
    }
    if (q.required) required.push(q.id);
  }
  return {
    message: input.message?.trim() || "",
    requestedSchema: { type: "object", properties, ...(required.length ? { required } : {}) },
    presentation: { kind: "questions", fieldOrder: input.questions.map((q) => q.id), fields },
  };
}

function errorResult(error: string, context?: ToolContext): ContentPart[] {
  context?.setError?.({ code: "QUESTIONS_ERROR", message: error });
  return [{ type: "text", content: JSON.stringify({ success: false, error }) }];
}

const resultSchema = z.discriminatedUnion("answered", [
  z.object({
    answered: z.literal(true),
    answers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
  }),
  z.object({ answered: z.literal(false), action: z.enum(["decline", "cancel"]) }),
]);

function readResult(result?: ContentPart[]) {
  if (!result) return null;
  try {
    return resultSchema.safeParse(JSON.parse(outputText(result))).data ?? null;
  } catch {
    return null;
  }
}

function answerLabel(value: ElicitationValue, options?: QuestionsInput["questions"][number]["options"]): string {
  const label = (value: string) => {
    const option = Array.isArray(options) ? options.find((option) => option?.value === value) : undefined;
    return typeof option?.label === "string" ? option.label : value;
  };
  return typeof value === "boolean"
    ? value
      ? "Yes"
      : "No"
    : Array.isArray(value)
      ? value.map(label).join(", ")
      : label(String(value));
}

// Answers are plain text, even when they contain Markdown or an Inline UI fence.
const escapeMarkdown = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]()<>#+.!|~$-]/g, "\\$&");

/** Core chat tool. The form shares controls with Inline UI; interrupts own its lifecycle. */
export const ASK_QUESTIONS_TOOL: Tool = {
  name: "ask_questions",
  description:
    "Ask 1–3 concise questions for missing information that materially changes the result. Prefer 2–4 choices with short tradeoff descriptions and, when useful, a recommended option. Users can write their own answer unless choices must be fixed. Recommendations are never preselected. Combine related questions, make routine decisions yourself, and proceed when the request is clear. Returns typed answers or a skipped/cancelled result.",
  inputSchema: questionsInputSchema,
  display: {
    header: (args, state) => {
      const questions = (Array.isArray(args?.questions) ? args.questions : []).filter(
        (q) => q && typeof q === "object",
      );
      const result = readResult(state.result);
      return {
        icon: HelpCircle,
        label: state.error
          ? "Question failed"
          : state.running
            ? "Waiting for answer…"
            : result?.answered
              ? "Answers received"
              : result
                ? result.action === "decline"
                  ? "Questions skipped"
                  : "Questions cancelled"
                : questions.length > 1
                  ? "Asked questions"
                  : "Asked a question",
        preview: result?.answered
          ? toolPreviewList(
              Object.entries(result.answers).map(([id, value]) =>
                answerLabel(value, questions.find((q) => q.id === id)?.options),
              ),
              "answers",
            )
          : result
            ? null
            : toolPreviewList(
                questions.map((q) => q.label),
                "questions",
              ),
      };
    },
    input: () => [],
    output: (parts, args) => {
      const result = readResult(parts);
      if (!result) return { code: outputText(parts), language: "text", name: "Result" };
      if (!result.answered)
        return {
          code: result.action === "decline" ? "Questions skipped." : "Questions cancelled.",
          language: "markdown",
        };
      const questions = questionsInputSchema.safeParse(args).data?.questions ?? [];
      const lines = Object.entries(result.answers).map(([id, value]) => {
        const question = questions.find((q) => q.id === id);
        return `**${escapeMarkdown(question?.label ?? id)}**  \n${escapeMarkdown(answerLabel(value, question?.options))}`;
      });
      return { code: lines.join("\n\n") || "No optional answers supplied.", language: "markdown", name: "Answers" };
    },
  },
  execute: async (args, execution) => {
    const context = execution?.context;
    context?.signal?.throwIfAborted();
    if (!context?.elicit && !context?.interruptible)
      return errorResult(
        "Structured questions aren't available in this context — ask in plain chat text instead.",
        context,
      );
    const parsed = questionsInputSchema.safeParse(args);
    if (!parsed.success) return errorResult(parsed.error.issues[0].message, context);
    const request = questionRequest(parsed.data);
    if (context.interruptible && !context.inputResponse) throw new MCPInputRequiredError("form", request);
    const result: ElicitationResult = context.inputResponse
      ? context.inputResponse.status === "cancelled"
        ? { action: "cancel" }
        : (context.inputResponse.payload as ElicitationResult)
      : await context.elicit!(request);
    if (!result || !["accept", "decline", "cancel"].includes(result.action))
      return errorResult("Invalid question response.", context);
    if (result.action !== "accept")
      return [{ type: "text", content: JSON.stringify({ answered: false, action: result.action }) }];
    const content = result.content ?? {};
    if (typeof content !== "object" || Array.isArray(content)) return errorResult("Invalid question answers.", context);
    const properties = request.requestedSchema!.properties;
    // Validate resumed answers too, so stale or malformed responses cannot bypass the form.
    for (const [id, value] of Object.entries(content)) {
      const schema = properties[id];
      if (
        !Object.hasOwn(properties, id) ||
        !schema ||
        (schema.type === "array"
          ? !Array.isArray(value) || value.some((item) => typeof item !== "string")
          : typeof value !== schema.type)
      ) {
        return errorResult(`Invalid answer for ${id}.`, context);
      }
    }
    const draft = Object.fromEntries(
      Object.entries(content).map(([id, value]) => [id, typeof value === "number" ? String(value) : value]),
    );
    const validation = validateElicitationForm(request.requestedSchema!, draft);
    if (validation.errors) return errorResult(Object.values(validation.errors)[0], context);
    return [{ type: "text", content: JSON.stringify({ answered: true, answers: validation.content ?? {} }) }];
  },
};
