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

function errorResult(error: string): TextContent[] {
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

// The tool has no config dependency (unlike `create_image`), so it's built once
// at module scope rather than per-render — a stable reference keeps the Studio
// provider's own useMemo from recomputing on every render.
const ASK_QUESTIONS_TOOL: Tool = {
  name: "ask_questions",
  description:
    "Ask the user one or more clarifying questions as a single structured form (multiple-choice, yes/no, short text, or number) instead of asking in plain chat text. Use at the start of ambiguous or open-ended work for one consolidated round covering everything you need — not one question per turn, and not for routine small talk. Prefer plain chat text for a single simple free-text question; reach for this when at least one question benefits from multiple-choice, a number, or a yes/no toggle, or when asking several things at once.",
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
        description: "One short line of context shown above the form, e.g. why you're asking.",
      },
      questions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: 'Short key for this answer, e.g. "audience" — used to label the answer you get back.',
            },
            label: { type: "string", description: "The question text." },
            description: { type: "string", description: "Optional one-line helper text under the question." },
            type: {
              type: "string",
              enum: ["text", "number", "boolean", "select", "multi_select"],
              description:
                '"select" (pick one) and "multi_select" (pick any) need `options`; "boolean" is a yes/no toggle; "text"/"number" are free entry.',
            },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: { value: { type: "string" }, label: { type: "string" } },
                required: ["value", "label"],
                additionalProperties: false,
              },
              description: 'Required for "select"/"multi_select" — the choices offered.',
            },
            required: {
              type: "boolean",
              description:
                "Whether an answer is mandatory. Defaults to false — most clarifying questions are skippable.",
            },
          },
          required: ["id", "label", "type"],
          additionalProperties: false,
        },
        description: "The questions to ask, rendered together as one form the user fills out and submits at once.",
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
  function: async (args: Record<string, unknown>, context?: ToolContext) => {
    if (!context?.elicit) {
      return errorResult("Structured questions aren't available in this context — ask in plain chat text instead.");
    }

    const questions = Array.isArray(args.questions) ? (args.questions as QuestionSpec[]) : [];
    if (questions.length === 0) {
      return errorResult("`questions` must include at least one question.");
    }

    const properties: Record<string, ElicitationPrimitiveSchema> = {};
    const required: string[] = [];

    for (const q of questions) {
      if (!q || typeof q !== "object") continue;

      const id = typeof q.id === "string" ? q.id.trim() : "";
      const label = typeof q.label === "string" ? q.label.trim() : "";
      if (!id || !label) continue;

      const description = typeof q.description === "string" ? q.description : undefined;
      const options = toOptions(q.options);

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
      return errorResult("No valid questions to ask — each needs an `id`, `label`, and `type`.");
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

/**
 * The `ask_questions` tool — pause and collect answers to one or more clarifying
 * questions as a single structured form, instead of asking in prose and waiting
 * for a free-text reply. Renders inline through the same elicitation mechanism
 * MCP servers use (`ToolContext.elicit`), so no bespoke UI is needed here.
 *
 * Always available — elicitation is a core chat capability, not an optional
 * service — so unlike `create_image` this isn't gated behind a config check.
 */
export function useQuestionsTool(): Tool {
  return ASK_QUESTIONS_TOOL;
}
