import { beforeEach, expect, it, vi } from "vitest";
import { recordClassification } from "./classificationTelemetry";

const record = vi.hoisted(() => vi.fn());
vi.mock("@opentelemetry/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@opentelemetry/api")>()),
  metrics: { getMeter: () => ({ createHistogram: () => ({ record }) }) },
}));
beforeEach(() => record.mockReset());

const rules = {
  categories: [{ name: "Legal Work", description: "Private criterion" }],
  risks: [
    { name: "PII", description: "Private criterion", threshold: 0.7 },
    { name: "HR", description: "Private criterion" },
  ],
  threshold: 0.6,
};
const reporting = { conversationId: "chat-1", model: "classifier" };

it("records every evaluated score with the thresholds used by the UI", () => {
  recordClassification(
    {
      categories: [{ id: "legal_work", confidence: 0.59 }],
      risks: [
        { id: "pii", confidence: 0.7 },
        { id: "hr", confidence: 0.2 },
      ],
    },
    rules,
    reporting,
  );
  const attributes = {
    "gen_ai.operation.name": "evaluate",
    "gen_ai.request.model": "classifier",
    "gen_ai.conversation.id": "chat-1",
  };
  expect(record.mock.calls).toEqual([
    [
      0.59,
      {
        ...attributes,
        "wingman.classification.kind": "category",
        "wingman.classification.id": "legal_work",
        "wingman.classification.threshold": 0.6,
        "wingman.classification.matched": false,
      },
    ],
    [
      0.7,
      {
        ...attributes,
        "wingman.classification.kind": "risk",
        "wingman.classification.id": "pii",
        "wingman.classification.threshold": 0.7,
        "wingman.classification.matched": true,
      },
    ],
    [
      0.2,
      {
        ...attributes,
        "wingman.classification.kind": "risk",
        "wingman.classification.id": "hr",
        "wingman.classification.threshold": 0.6,
        "wingman.classification.matched": false,
      },
    ],
  ]);
  expect(JSON.stringify(record.mock.calls)).not.toContain("Private");
  expect(JSON.stringify(record.mock.calls)).not.toContain("wingman.message.id");
  expect(JSON.stringify(record.mock.calls)).not.toContain("wingman.run.id");
});

it("leaves user identity to the backend", () => {
  recordClassification({ categories: [], risks: [{ id: "hr", confidence: 0 }] }, rules, reporting);
  expect(record.mock.calls[0][1]).not.toHaveProperty("user.email");
  expect(record.mock.calls[0][1]).not.toHaveProperty("user.id");
});

it("skips requests for which classification returned no answers", () => {
  recordClassification({ categories: [], risks: [] }, rules, reporting);
  expect(record).not.toHaveBeenCalled();
});

it("keeps reporting failures from breaking consent or risk warnings", () => {
  record.mockImplementationOnce(() => {
    throw new Error("Exporter failure");
  });
  expect(() =>
    recordClassification({ categories: [], risks: [{ id: "hr", confidence: 0.8 }] }, rules, reporting),
  ).not.toThrow();
});
