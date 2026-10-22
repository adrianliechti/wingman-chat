import { beforeEach, expect, it, vi } from "vitest";
import { recordClassification } from "./classificationTelemetry";

const { record, flush } = vi.hoisted(() => ({ record: vi.fn(), flush: vi.fn() }));
vi.mock("@/shared/lib/classificationMetrics", () => ({
  classificationMeter: () => ({ createHistogram: () => ({ record }) }),
  flushClassificationMetrics: flush,
}));
beforeEach(() => {
  record.mockReset();
  flush.mockReset();
});

const rules = {
  categories: [{ id: "legal_work", name: "Legal Work", description: "Private criterion" }],
  risks: [
    { id: "pii", name: "PII", description: "Private criterion", threshold: 0.7 },
    { id: "hr", name: "HR", description: "Private criterion" },
  ],
  threshold: 0.6,
};
const reporting = { conversationId: "chat-1", model: "classifier" };

it("records categories and only matched risks with the thresholds used by the UI", () => {
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
    "wingman.classification.event_id": expect.any(String),
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
  ]);
  expect(flush).toHaveBeenCalledTimes(1);
  const eventIDs = record.mock.calls.map(([, attrs]) => attrs["wingman.classification.event_id"]);
  expect(new Set(eventIDs).size).toBe(1);
  expect(eventIDs[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(record.mock.calls)).not.toContain("Private");
  expect(JSON.stringify(record.mock.calls)).not.toContain("wingman.message.id");
  expect(JSON.stringify(record.mock.calls)).not.toContain("wingman.run.id");
});

it("skips risks below both default and per-risk thresholds", () => {
  recordClassification(
    {
      categories: [],
      risks: [
        { id: "pii", confidence: 0.69 },
        { id: "hr", confidence: 0.59 },
      ],
    },
    rules,
    reporting,
  );
  expect(record).not.toHaveBeenCalled();
  expect(flush).not.toHaveBeenCalled();
});

it("leaves user identity to the backend", () => {
  recordClassification({ categories: [], risks: [{ id: "hr", confidence: 0.6 }] }, rules, reporting);
  expect(record.mock.calls[0][1]).not.toHaveProperty("user.email");
  expect(record.mock.calls[0][1]).not.toHaveProperty("user.id");
});

it("skips requests for which classification returned no answers", () => {
  recordClassification({ categories: [], risks: [] }, rules, reporting);
  expect(record).not.toHaveBeenCalled();
  expect(flush).not.toHaveBeenCalled();
});

it("keeps reporting failures from breaking consent or risk warnings", () => {
  record.mockImplementationOnce(() => {
    throw new Error("Exporter failure");
  });
  expect(() =>
    recordClassification({ categories: [], risks: [{ id: "hr", confidence: 0.8 }] }, rules, reporting),
  ).not.toThrow();
});

it("preserves telemetry identity when display names change", () => {
  recordClassification(
    { categories: [{ id: "legal_work", confidence: 0.9 }], risks: [{ id: "hr", confidence: 0.8 }] },
    {
      ...rules,
      categories: rules.categories.map((category) => ({ ...category, name: "Legal support" })),
      risks: rules.risks.map((risk) => ({ ...risk, name: "Renamed warning" })),
    },
    reporting,
  );
  expect(record.mock.calls.map(([, attributes]) => attributes["wingman.classification.id"])).toEqual([
    "legal_work",
    "hr",
  ]);
});

it("gives separate accepted results distinct event IDs", () => {
  for (let i = 0; i < 2; i++) {
    recordClassification({ categories: [{ id: "legal_work", confidence: 0.9 }], risks: [] }, rules, reporting);
  }
  expect(record.mock.calls[0][1]["wingman.classification.event_id"]).not.toBe(
    record.mock.calls[1][1]["wingman.classification.event_id"],
  );
  expect(flush).toHaveBeenCalledTimes(2);
});
