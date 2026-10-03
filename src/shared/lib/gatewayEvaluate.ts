import { BaseEvaluateAdapter } from "@tanstack/ai";
import { z } from "zod";
import type { ReasoningEffort } from "../types/chat";

type Options = { effort?: ReasoningEffort };
const probability = z.number().min(0).max(1);
const probabilities = z.record(z.string(), probability);
const responseSchema = z.object({
  model: z.string().optional(),
  id: z.string().optional(),
  provider: z.string().optional(),
  answers: z.record(
    z.string(),
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("choice"), choice: z.string(), confidence: probability, probabilities }),
      z.object({ type: z.literal("noul"), noul: probability }),
      z.object({
        type: z.literal("score"),
        score: z.number(),
        confidence: probability,
        probabilities,
        legend: z.record(z.string(), z.string()),
      }),
    ]),
  ),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});

/** The gateway speaks the native Evaluate protocol; validate at the HTTP boundary. */
export class GatewayEvaluateAdapter extends BaseEvaluateAdapter<string, Options> {
  readonly name = "wingman";
  private readonly request: (body: object, signal?: AbortSignal) => Promise<unknown>;

  constructor(model: string, request: (body: object, signal?: AbortSignal) => Promise<unknown>) {
    super({}, model);
    this.request = request;
  }

  async evaluate({
    state,
    questions,
    modelOptions,
    abortSignal,
    logger,
  }: Parameters<BaseEvaluateAdapter<string, Options>["evaluate"]>[0]) {
    const body = { model: this.model, state, questions, ...modelOptions };
    logger.request("wingman.systemone", body);
    try {
      const result = responseSchema.parse(await this.request(body, abortSignal));
      for (const [key, question] of Object.entries(questions)) {
        const answer = result.answers[key];
        if (
          question.type === "choice" &&
          answer?.type === "choice" &&
          !Object.hasOwn(question.criteria, answer.choice)
        ) {
          throw new Error(`Unknown choice "${answer.choice}" for "${key}"`);
        }
      }
      return {
        ...result,
        model: result.model ?? this.model,
        usage: {
          promptTokens: result.usage?.input_tokens ?? 0,
          completionTokens: result.usage?.output_tokens ?? 0,
          totalTokens: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0),
        },
      };
    } catch (error) {
      logger.errors("wingman.systemone", { error });
      throw error;
    }
  }
}
