import { expect, it } from "vitest";
import { internetToolPresentation } from "./internetPresentation";

it("shows batched search queries first and every filter without JSON", () => {
  const args = {
    query: "First lookup",
    queries: ["Second lookup", "Third lookup"],
    allowed_domains: ["github.com", "go.dev"],
    max_results: 8,
  };
  expect(internetToolPresentation("web_search").display!.input!(args)).toEqual([
    { name: "Search queries", code: "First lookup\nSecond lookup\nThird lookup", language: "text" },
    { name: "Allowed domains", code: "github.com, go.dev", language: "text" },
    { name: "Max results", code: "8", language: "text" },
  ]);
});

it("shows the exact fetch URL and keeps nested options readable", () => {
  const display = internetToolPresentation("web_fetch").display!;
  const args = {
    url: "https://example.test/report?a=1&b=2",
    query: "Revenue growth",
    source_preferences: { include: ["Primary sources", "Reports"], verify: true },
  };
  expect(display.header!(args, {}).preview).toBe(args.url);
  expect(display.input!(args)).toEqual([
    { name: "Page URL", code: args.url, language: "text" },
    { name: "Query", code: "Revenue growth", language: "text" },
    { name: "Source preferences", code: "Include: Primary sources, Reports\nVerify: Yes", language: "text" },
  ]);
});
