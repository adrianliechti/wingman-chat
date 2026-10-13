import { expect, it } from "vitest";
import { reasoningHint, reasoningPreview } from "./ReasoningDisplay";

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

it("previews only the latest paragraph, including its streaming continuation", () => {
  expect(reasoningPreview("First step.\n\nLatest step.\nStill working.")).toBe("Latest step.\nStill working.");
  expect(reasoningPreview("First step.\n \nLatest step.\n\n")).toBe("Latest step.");
});

it("keeps section headings in the title instead of duplicating them in the preview", () => {
  expect(reasoningPreview("Earlier step.\n\n## Checking sources")).toBe("");
  expect(reasoningPreview("**Checking sources**")).toBe("");
  expect(reasoningPreview("")).toBe("");
  expect(reasoningPreview("**Checking sources** carefully.")).toBe("**Checking sources** carefully.");
});
