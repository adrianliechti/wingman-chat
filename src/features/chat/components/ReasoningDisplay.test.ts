import { expect, it } from "vitest";
import { reasoningHint } from "./ReasoningDisplay";

it("uses a lone opening heading as the hint and keeps it out of the body", () => {
  expect(reasoningHint("**Retrieving current news details**\n\nI need to summarize the news.")).toEqual({
    hint: "Retrieving current news details",
    body: "I need to summarize the news.",
  });
});

it("names the latest step while keeping every section in the body", () => {
  const reasoning = "**Checking sources**\n\nFirst pass.\n\n## Summarizing findings\n\nSecond pass.";
  expect(reasoningHint(reasoning)).toEqual({ hint: "Summarizing findings", body: reasoning });
});

it("shows a heading as soon as it streams in, but not bold text inside a paragraph", () => {
  expect(reasoningHint("**Planning**").hint).toBe("Planning");
  expect(reasoningHint("**Planning** the next step\n\nMore.")).toEqual({
    body: "**Planning** the next step\n\nMore.",
  });
  expect(reasoningHint("Plain thinking.")).toEqual({ body: "Plain thinking." });
});
