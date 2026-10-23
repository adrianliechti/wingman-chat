import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MCPInputRequiredError } from "@tanstack/ai-mcp";
import { ASK_QUESTIONS_TOOL, questionsInputSchema, questionRequest } from "./questionsTool";
import { resolveToolHeader, resolveToolInput, resolveToolOutput } from "../components/toolDisplay";
import type { ElicitationResult } from "@/shared/types/elicitation";
import type { ToolContext } from "@/shared/types/chat";

describe("structured question validation", () => {
  it.each([
    [{ id: "format", label: "Which format?", type: "select" }],
    [{ id: "format", label: "Which formats?", type: "multi_select", options: [] }],
    [
      {
        id: "format",
        label: "Which format?",
        type: "select",
        options: [
          { value: "a", label: "A" },
          { value: "a", label: "B" },
        ],
      },
    ],
    [
      { id: "format", label: "Which format?", type: "text" },
      { id: "format", label: "What audience?", type: "text" },
    ],
    [
      { id: "", label: "Which format?", type: "text" },
      { id: "audience", label: "What audience?", type: "text" },
    ],
  ])("rejects an ambiguous or unanswerable form %j", async (...questions) => {
    const elicit = vi.fn().mockResolvedValue({ action: "accept", content: {} });
    const setError = vi.fn();
    const result = await ASK_QUESTIONS_TOOL.execute(
      { questions },
      { context: { elicit, setError }, emitCustomEvent() {} },
    );
    expect(elicit).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(expect.objectContaining({ code: "QUESTIONS_ERROR" }));
    expect(result).toEqual([{ type: "text", content: expect.stringContaining('"success":false') }]);
  });
});

describe("carousel layout", () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, label: `Question ${i}?`, type: "text" }));

  it("rejects more than three questions unless the carousel layout is requested", () => {
    expect(questionsInputSchema.safeParse({ questions: many }).success).toBe(false);
    expect(questionsInputSchema.safeParse({ layout: "form", questions: many }).success).toBe(false);
    expect(questionsInputSchema.safeParse({ layout: "carousel", questions: many }).success).toBe(true);
    expect(questionsInputSchema.safeParse({ layout: "carousel", questions: many.slice(0, 2) }).success).toBe(true);
    // execute() returns the first issue to the model, so it must say how to recover.
    expect(questionsInputSchema.safeParse({ questions: many }).error?.issues[0].message).toBe(
      'Ask at most 3 questions at once, or set layout to "carousel" for up to 10.',
    );
  });

  it("caps the carousel at ten questions", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `q${i}`, label: `Question ${i}?`, type: "text" }));
    expect(questionsInputSchema.safeParse({ layout: "carousel", questions: eleven }).success).toBe(false);
  });

  it("passes the layout to the form only when requested", () => {
    expect(
      questionRequest(questionsInputSchema.parse({ layout: "carousel", questions: many })).presentation?.layout,
    ).toBe("carousel");
    expect(questionRequest(questionsInputSchema.parse({ questions: many.slice(0, 2) })).presentation?.layout).toBe(
      undefined,
    );
  });
});

const input = {
  message: "Help shape the result.",
  questions: [
    {
      id: "format",
      label: "Which format?",
      type: "select",
      options: [
        { value: "brief", label: "Brief", description: "A focused one-page overview.", recommended: true },
        { value: "report", label: "Full report" },
      ],
    },
    { id: "publish", label: "Publish it?", type: "boolean", required: true },
    { id: "count", label: "How many?", type: "number" },
  ],
};
const execute = (context: ToolContext, args: Record<string, unknown> = input) =>
  ASK_QUESTIONS_TOOL.execute(args, { context, emitCustomEvent() {} });

it("keeps presentation hints separate from schema restrictions and never preselects recommendations", () => {
  const request = questionRequest(questionsInputSchema.parse(input));
  expect(request.requestedSchema).toEqual({
    type: "object",
    properties: {
      format: { title: "Which format?", type: "string" },
      publish: { title: "Publish it?", type: "boolean" },
      count: { title: "How many?", type: "number" },
    },
    required: ["publish"],
  });
  expect(request.presentation?.fields.format).toEqual({ options: input.questions[0].options, allowOther: true });
  expect(request.presentation?.fieldOrder).toEqual(["format", "publish", "count"]);
  const closed = questionRequest(
    questionsInputSchema.parse({ questions: [{ ...input.questions[0], allow_other: false }] }),
  );
  expect(closed.requestedSchema?.properties.format).toMatchObject({
    oneOf: [
      { const: "brief", title: "Brief" },
      { const: "report", title: "Full report" },
    ],
  });
});

it("exports a usable JSON schema and limits the number of questions", () => {
  expect(z.toJSONSchema(questionsInputSchema)).toMatchObject({
    type: "object",
    // The schema allows the carousel maximum; plain forms are capped at 3 by validation.
    properties: { questions: { maxItems: 10 }, layout: { enum: ["form", "carousel"] } },
  });
  expect(
    questionsInputSchema.safeParse({
      questions: Array.from({ length: 4 }, (_, i) => ({ id: String(i), label: "Question", type: "text" })),
    }).success,
  ).toBe(false);
  expect(questionsInputSchema.safeParse({ questions: [{ id: "x", label: "?", type: "unsupported" }] }).success).toBe(
    false,
  );
  expect(
    questionsInputSchema.safeParse({
      questions: [
        { ...input.questions[0], options: input.questions[0].options!.map((o) => ({ ...o, recommended: true })) },
      ],
    }).success,
  ).toBe(false);
});

it("uses the same request for native interrupts and live elicitation callbacks", async () => {
  const elicit = vi.fn().mockResolvedValue({ action: "decline" });
  await execute({ elicit });
  await expect(execute({ interruptible: true })).rejects.toMatchObject({
    name: "MCPInputRequiredError",
    kind: "form",
    request: elicit.mock.calls[0][0],
  });
  await expect(execute({ interruptible: true })).rejects.toBeInstanceOf(MCPInputRequiredError);
});

it.each([false, true])(
  "returns typed answers, including false and zero, through the %s resumable path",
  async (resume) => {
    const answer: ElicitationResult = {
      action: "accept",
      content: { format: "A custom format", publish: false, count: 0 },
    };
    const result = await execute(
      resume
        ? { interruptible: true, inputResponse: { status: "resolved", payload: answer } }
        : { elicit: async () => answer },
    );
    expect(result).toEqual([{ type: "text", content: JSON.stringify({ answered: true, answers: answer.content }) }]);
  },
);

it.each(["decline", "cancel"] as const)("preserves %s without inventing answers", async (action) => {
  expect(await execute({ elicit: async () => ({ action }) })).toEqual([
    { type: "text", content: JSON.stringify({ answered: false, action }) },
  ]);
});

it("settles cancelled native requests and respects an already-aborted caller", async () => {
  expect(await execute({ interruptible: true, inputResponse: { status: "cancelled" } })).toEqual([
    { type: "text", content: '{"answered":false,"action":"cancel"}' },
  ]);
  const elicit = vi.fn();
  await expect(execute({ elicit, signal: AbortSignal.abort() })).rejects.toThrow();
  expect(elicit).not.toHaveBeenCalled();
});

it.each([{}, { publish: "false" }, { publish: false, count: Infinity }, { publish: false, extra: "unknown" }])(
  "validates resumed answers %j",
  async (content) => {
    const setError = vi.fn();
    await execute({
      interruptible: true,
      inputResponse: { status: "resolved", payload: { action: "accept", content } },
      setError,
    });
    expect(setError).toHaveBeenCalledWith(expect.objectContaining({ code: "QUESTIONS_ERROR" }));
  },
);

it("preserves fixed choices and accepts written answers only for open choices", async () => {
  for (const type of ["select", "multi_select"])
    for (const allow_other of [false, true]) {
      const setError = vi.fn();
      const result = await execute(
        {
          elicit: async () => ({
            action: "accept",
            content: { format: type === "select" ? "Custom" : ["brief", "Custom"] },
          }),
          setError,
        },
        { questions: [{ ...input.questions[0], type, allow_other }] },
      );
      expect(setError).toHaveBeenCalledTimes(allow_other ? 0 : 1);
      if (allow_other)
        expect(result).toEqual([
          {
            type: "text",
            content: JSON.stringify({
              answered: true,
              answers: { format: type === "select" ? "Custom" : ["brief", "Custom"] },
            }),
          },
        ]);
    }
});

it("shows answer labels in collapsed previews and a readable escaped summary", () => {
  const args = JSON.stringify(input);
  const result = [
    {
      type: "text" as const,
      content: JSON.stringify({ answered: true, answers: { format: "report", publish: false, count: 0 } }),
    },
  ];
  expect(resolveToolInput(ASK_QUESTIONS_TOOL, args)).toEqual([]);
  expect(resolveToolHeader(ASK_QUESTIONS_TOOL, "ask_questions", args, { result })).toMatchObject({
    label: "Answers received",
    preview: "3 answers: Full report, No",
  });
  expect(resolveToolOutput(ASK_QUESTIONS_TOOL, result, args)).toEqual({
    code: "**Which format?**  \nFull report\n\n**Publish it?**  \nNo\n\n**How many?**  \n0",
    language: "markdown",
    name: "Answers",
  });
  const literal = [
    {
      type: "text" as const,
      content: JSON.stringify({
        answered: true,
        answers: { format: '```ui\n{"createSurface":{}}\n``` <script> [link](https://example.com)' },
      }),
    },
  ];
  const summary = resolveToolOutput(ASK_QUESTIONS_TOOL, literal, args)!.code;
  expect(summary).not.toContain("```ui");
  expect(summary).toContain("\\<script\\>");
});
