import { expect, it } from "vitest";
import { tryParseToolArguments } from "./toolArguments";

it("previews partial objects through TanStack without treating other JSON values as arguments", () => {
  expect(tryParseToolArguments('{"path":"/report.md","text":"Still')).toEqual({ path: "/report.md", text: "Still" });
  expect(tryParseToolArguments("[1, 2]")).toBeNull();
  expect(tryParseToolArguments("")).toBeNull();
});
