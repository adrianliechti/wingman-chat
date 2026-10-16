import { expect, it } from "vitest";
import { inputLabel, inputValue, primaryInputKeys } from "./toolInput";

it("names arguments the way people read them", () => {
  expect(inputLabel("max_chars")).toBe("Max chars");
  expect(inputLabel("pageUrl")).toBe("Page URL");
  expect(inputLabel("allowed-domains")).toBe("Allowed domains");
  expect(inputLabel("ids")).toBe("IDs");
});

it("renders values without JSON", () => {
  expect(inputValue(true)).toBe("Yes");
  expect(inputValue(["a", "b"])).toBe("a, b");
  expect(inputValue({ sort: "date", desc: false })).toBe("Sort: date\nDesc: No");
  expect(inputValue("data:image/png;base64,AAAA")).toBe("image/png data");
  expect(inputValue(null)).toBe("None");
});

it("leads with required text arguments, across schema branches", () => {
  const fetch = {
    type: "object",
    properties: { url: { type: "string" }, query: { type: "string" }, max_chars: { type: "integer" } },
    required: ["url"],
  };
  expect(primaryInputKeys({ query: "Focus", url: "https://example.test", max_chars: 100 }, fetch)).toEqual(["url"]);
  const search = {
    type: "object",
    properties: { query: { type: "string" }, queries: { type: "array" }, allowed_domains: { type: "array" } },
    anyOf: [{ required: ["query"] }, { required: ["queries"] }],
  };
  expect(primaryInputKeys({ allowed_domains: ["github.com"], queries: ["a", "b"] }, search)).toEqual(["queries"]);
});

it("falls back to the first declared text argument, then a URL or the longest text", () => {
  // Converted schemas can lose `anyOf` requirements but keep property order.
  const schema = { allOf: [{ properties: { query: {}, queries: {}, allowed_domains: {} } }] };
  expect(primaryInputKeys({ allowed_domains: ["github.com"], queries: ["a"] }, schema)).toEqual(["queries"]);
  // Restored interrupts may sort keys, so input order carries no meaning.
  expect(primaryInputKeys({ max_chars: 9, query: "Coverage", url: "https://example.test" })).toEqual(["url"]);
  expect(primaryInputKeys({ allowed_domains: ["github.com"], queries: ["electric vehicles", "chargers"] })).toEqual([
    "queries",
  ]);
  expect(primaryInputKeys({ limit: 3, flags: { a: true } })).toEqual([]);
});
