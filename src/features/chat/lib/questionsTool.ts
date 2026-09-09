import { HelpCircle } from "lucide-react";
import type { TextContent, Tool, ToolContext } from "@/shared/types/chat";
import type { ElicitationPrimitiveSchema, ElicitationSchema } from "@/shared/types/elicitation";

type QuestionOption = { value?: unknown; label?: unknown };

type QuestionSpec = {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  type?: unknown;
  options?: unknown;
  required?: unknown;
};

function errorResult(error: string, context?: ToolContext): TextContent[] {
  context?.setError?.({ code: "QUESTIONS_ERROR", message: error });
  return [{ type: "text", text: JSON.stringify({ success: false, error }) }];
}

function asPrimitiveString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

function toOptions(raw: unknown): Array<{ const: string; title: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is QuestionOption => !!o && typeof o === "object")
    .map((o) => {
      const value = asPrimitiveString(o.value);
      const label = asPrimitiveString(o.label);
      return { const: value, title: label || value };
    })
    .filter((o) => o.const !== "");
}

/** Core chat tool. Uses the shared elicitation UI without an optional service. */
export const ASK_QUESTIONS_TOOL: Tool = {
  name: "ask_questions",
  description:
    "Ask for missing information that materially changes the result, using one structured form. Prefer choices where useful and combine related questions. Make routine decisions yourself and proceed when the request is clear. A single simple free-text question can be asked in chat. Returns the user's answers or a skipped/cancelled result.",
  display: {
    header: (_args, state) => ({
      icon: HelpCircle,
      label: state.error ? "Question failed" : state.running ? "Waiting for answer…" : "Asked a question",
    }),
  },
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Optional short explanation of why the answers are needed, shown above the form.",
      },
      questions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: 'Unique answer key within this form, e.g. "audience".',
            },
            label: { type: "string", description: "The question text." },
            description: { type: "string", description: "Optional one-line helper text under the question." },
            type: {
              type: "string",
              enum: ["text", "number", "boolean", "select", "multi_select"],
              description:
                'Use "select" for one choice, "multi_select" for several, "boolean" for yes/no, or "text"/"number" for free entry. Choice types require options.',
            },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: { value: { type: "string" }, label: { type: "string" } },
                required: ["value", "label"],
                additionalProperties: false,
              },
              description: 'Nonempty choices for "select" and "multi_select". Values are returned as the answers.',
            },
            required: {
              type: "boolean",
              description: "Defaults to false. Require an answer only when the task cannot proceed without it.",
            },
          },
          required: ["id", "label", "type"],
          additionalProperties: false,
        },
        description: "Related questions to show and submit together. Include only what is needed to proceed.",
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
  function: async (args: Record<string, unknown>, context?: ToolContext) => {
    context?.signal?.throwIfAborted();
    if (!context?.elicit) {
      return errorResult(
        "Structured questions aren't available in this context — ask in plain chat text instead.",
        context,
      );
    }

    const questions = Array.isArray(args.questions) ? (args.questions as QuestionSpec[]) : [];
    if (questions.length === 0) {
      return errorResult("`questions` must include at least one question.", context);
    }

    const properties = Object.create(null) as Record<string, ElicitationPrimitiveSchema>;
    const required: string[] = [];

    for (const q of questions) {
      if (!q || typeof q !== "object") return errorResult("Each question must be an object.", context);

      const id = typeof q.id === "string" ? q.id.trim() : "";
      const label = typeof q.label === "string" ? q.label.trim() : "";
      if (!id || !label) return errorResult("Each question needs a nonempty id and label.", context);
      if (Object.hasOwn(properties, id))
        return errorResult(`Duplicate question id: ${id}. Use a unique id for each question.`, context);

      const description = typeof q.description === "string" ? q.description : undefined;
      const options = toOptions(q.options);
      if (q.type === "select" || q.type === "multi_select") {
        if (options.length === 0) return errorResult(`Question ${id} needs at least one nonempty option.`, context);
        if (new Set(options.map((option) => option.const)).size !== options.length) {
          return errorResult(
            `Question ${id} has duplicate option values. Use a unique value for each choice.`,
            context,
          );
        }
      }

      switch (q.type) {
        case "boolean":
          properties[id] = { type: "boolean", title: label, description };
          break;
        case "number":
          properties[id] = { type: "number", title: label, description };
          break;
        case "select":
          properties[id] = { type: "string", title: label, description, oneOf: options };
          break;
        case "multi_select":
          properties[id] = { type: "array", title: label, description, items: { anyOf: options } };
          break;
        default:
          properties[id] = { type: "string", title: label, description };
      }

      if (q.required === true) required.push(id);
    }

    if (Object.keys(properties).length === 0) {
      return errorResult("No valid questions to ask — each needs an `id`, `label`, and `type`.", context);
    }

    const requestedSchema: ElicitationSchema = {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
    };

    const message =
      typeof args.message === "string" && args.message.trim() ? args.message.trim() : "A few quick questions:";

    const result = await context.elicit({ message, requestedSchema });

    if (result.action !== "accept") {
      return [{ type: "text", text: JSON.stringify({ answered: false, action: result.action }) }];
    }

    return [{ type: "text", text: JSON.stringify({ answered: true, answers: result.content ?? {} }) }];
  },
};
