import { describe, expect, it } from "vitest";
import { extractUiFences, parseMessages, MAX_UI_SOURCE } from "./protocol";
import fixtures from "./fixtures/components.json";

const a = JSON.stringify(fixtures.Text),
  b = JSON.stringify(fixtures.Slider);
it.each([a, `[${a},${b}]`, `${a}\n${b}`])("accepts supported JSON framing", (source) => {
  const parsed = parseMessages(source);
  expect(parsed.error).toBeUndefined();
  expect(parsed.pending).toBe(false);
  expect(parsed.messages.length).toBeGreaterThan(0);
});
it("applies complete streaming messages but never fabricates a partial one", () => {
  expect(parseMessages(`[${a},${b.slice(0, -5)}`, true)).toMatchObject({ messages: [fixtures.Text], pending: true });
  expect(parseMessages(b.slice(0, -5), true)).toMatchObject({ messages: [], pending: true });
  expect(parseMessages(b.slice(0, -5)).error).toBeDefined();
});
describe("strict validation", () => {
  it.each([
    "null",
    "42",
    "{not json}",
    `[${a},]`,
    JSON.stringify({ ...fixtures.Text, version: "v0.9" }),
    JSON.stringify({ children: [] }),
    JSON.stringify({ version: "v1.0", updateDataModel: { surfaceId: "main" } }),
    " ".repeat(MAX_UI_SOURCE + 1),
  ])("rejects invalid or unsupported input", (source) => {
    expect(parseMessages(source).error).toBeDefined();
  });
});
it("extracts the same nested and open fences that Markdown renders", () => {
  const markdown = `Text\n\n\`\`\`json\n{}\n\`\`\`\n~~~a2ui\n${a}\n~~~\n\`\`\`ui\n${b.slice(0, -5)}`;
  expect(extractUiFences(markdown)).toEqual([a, b.slice(0, -5)]);
  expect(extractUiFences(markdown)).toEqual([a, b.slice(0, -5)]);
});

it("preserves traversal order for block quotes and lists", () => {
  expect(extractUiFences("> ```ui\n> " + a + "\n> ```\n\n- Example\n\n  ```a2ui\n  " + b + "\n  ```")).toEqual([a, b]);
});
it.each([`${a}${b}`, `[${a},,${b.slice(0, -4)}`, `[,${a}`])("rejects malformed stream framing", (source) => {
  expect(parseMessages(source, true).error).toBeDefined();
});
