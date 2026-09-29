import { describe, expect, it } from "vitest";
import { resolveScriptLanguage } from "./scriptLanguage";

describe("script interpreter selection", () => {
  it.each([
    ["/analysis.py", "python"],
    ["/transform.js", "javascript"],
    ["/transform.mjs", "javascript"],
    ["/transform.cjs", "javascript"],
    ["/skills/plugin:skill/scripts/run.sh", "bash"],
    ["/scripts/RUN.BASH", "bash"],
  ])("detects %s by extension", (path, language) => {
    expect(resolveScriptLanguage(undefined, path, "")).toBe(language);
  });

  it.each([
    ["#!/usr/bin/env python3", "python"],
    ["#!/usr/bin/python3.14 -u", "python"],
    ["#!/usr/bin/env -S node --no-warnings", "javascript"],
    ["#!/bin/bash -e", "bash"],
    ["\uFEFF#!/bin/sh\r", "bash"],
  ])("detects a shebang before considering the extension: %s", (shebang, language) => {
    expect(resolveScriptLanguage(undefined, "/scripts/run", `${shebang}\nbody`)).toBe(language);
    expect(resolveScriptLanguage(undefined, "/scripts/run.txt", `${shebang}\nbody`)).toBe(language);
  });

  it("allows an explicit runtime override and does not guess inline code", () => {
    expect(resolveScriptLanguage("python", "/script.sh", "#!/bin/bash\n")).toBe("python");
    expect(resolveScriptLanguage("bash", undefined, "echo hi")).toBe("bash");
    expect(() => resolveScriptLanguage(undefined, undefined, "print(1)")).toThrow("Inline code requires language");
    expect(() => resolveScriptLanguage(undefined, undefined, "#!/bin/bash\necho hi")).toThrow(
      "Inline code requires language",
    );
    expect(() => resolveScriptLanguage(undefined, "/scripts/bash", "echo hi")).toThrow("Cannot detect");
    expect(() => resolveScriptLanguage("ruby", "/script.py", "")).toThrow("Unsupported script language");
  });
});
