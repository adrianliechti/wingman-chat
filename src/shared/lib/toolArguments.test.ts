import { expect, it } from "vitest";
import { toolArgumentPath, tryParseToolArguments } from "./toolArguments";

it("previews partial objects through TanStack without treating other JSON values as arguments", () => {
  expect(tryParseToolArguments('{"path":"/report.md","text":"Still')).toEqual({ path: "/report.md", text: "Still" });
  expect(tryParseToolArguments("[1, 2]")).toBeNull();
  expect(tryParseToolArguments("")).toBeNull();
});

it("prefers canonical path and falls back to file_path only when path is absent", () => {
  expect(toolArgumentPath({ path: "/new.md", file_path: "/old.md" })).toBe("/new.md");
  expect(toolArgumentPath({ file_path: "/old.md" })).toBe("/old.md");
  expect(toolArgumentPath({ path: null, file_path: "/old.md" })).toBeUndefined();
  expect(toolArgumentPath(null)).toBeUndefined();
});
