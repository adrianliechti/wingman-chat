import { metrics } from "@opentelemetry/api";
import { categorySlug, type CategoryConfig, type RiskConfig } from "@/shared/config";
import type { ClassificationMatch } from "./classificationQuestions";

/** Record decisions using the same OTel meter and exporter as model usage. */
export function recordClassification(
  result: { categories: ClassificationMatch[]; risks: ClassificationMatch[] },
  rules: { categories: CategoryConfig[]; risks: RiskConfig[]; threshold: number },
  reporting: { conversationId: string; model: string },
): void {
  try {
    const scoreHistogram = metrics.getMeter("wingman").createHistogram("wingman.classification.score", {
      description: "Category confidence or risk probability for each classified prompt",
      unit: "1",
      advice: { explicitBucketBoundaries: [0, 0.25, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
    });
    // Categories and risks share the same slug helper, so one lookup fits both.
    const record = (
      kind: "category" | "risk",
      matches: ClassificationMatch[],
      configs: (CategoryConfig | RiskConfig)[],
    ) => {
      for (const { id, confidence } of matches) {
        const config = configs.find((config) => categorySlug(config.name) === id);
        if (!config) continue;
        const threshold = config.threshold ?? rules.threshold;
        scoreHistogram.record(confidence, {
          "gen_ai.operation.name": "evaluate",
          "gen_ai.request.model": reporting.model,
          "gen_ai.conversation.id": reporting.conversationId,
          "wingman.classification.kind": kind,
          "wingman.classification.id": id,
          "wingman.classification.threshold": threshold,
          "wingman.classification.matched": confidence >= threshold,
        });
      }
    };
    record("category", result.categories, rules.categories);
    record("risk", result.risks, rules.risks);
  } catch {
    // Reporting is best effort and must not affect consent or risk warnings.
  }
}
