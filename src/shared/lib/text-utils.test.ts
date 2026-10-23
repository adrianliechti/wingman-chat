import { describe, expect, it } from "vitest";
import { matchGlob, textFormat } from "./text-utils";

describe("matchGlob", () => {
  it.each([
    ["policy/returns.md", "{policy/returns.md,**/*}", true],
    [
      "config/returns.json",
      "{policy/returns.md,config/returns.json,web/returns.html,archive/returns-2024.md,assets/logo.svg,exports/**/*,**/*}",
      true,
    ],
    ["exports/rollout.json", "{policy/returns.md,exports/**/*}", true],
    ["exports/deep/rollout.json", "{policy/returns.md,exports/**/*}", true],
    ["src/app.ts", "{src/**/*.ts,*.md}", true],
    ["src/deep/app.tsx", "{src/**/*.{ts,tsx},docs/**/*.md}", true],
    ["docs/readme.md", "{src/**/*.{ts,tsx},docs/**/*.md}", true],
    ["src/app.js", "{src/**/*.{ts,tsx},docs/**/*.md}", false],
    ["src/app.ts", "{src,lib}/**/*.{ts,tsx}", true],
    ["lib/deep/app.tsx", "{src,lib}/**/*.{ts,tsx}", true],
    ["assets/a.svg", "{assets/[ab].svg,docs/readme?.md}", true],
    ["assets/c.svg", "{assets/[ab].svg,docs/readme?.md}", false],
    ["a,b.txt", "{a[,{}]b.txt,other.txt}", true],
    ["a{b.txt", "{a[,{}]b.txt,other.txt}", true],
    ["a+b.txt", "{a+b.txt,other.txt}", true],
    ["aaab.txt", "{a+b.txt,other.txt}", false],
    ["a,b.txt", "a,b.txt", true],
    ["name.txt", "{,prefix/}name.txt", true],
    ["prefix/name.txt", "{,prefix/}name.txt", true],
    ["{unfinished.txt", "{unfinished.txt", true],
    ["unfinished}.txt", "unfinished}.txt", true],
    ["src/app.ts", "src/**/*.ts", true],
    ["src/deep/app.ts", "src/**/*.ts", true],
    ["src/deep/app.ts", "src/*.ts", false],
    ["src/app.TS", "src/*.ts", true],
    ["src\\app.ts", "src\\*.ts", true],
    ["before[z-a]after", "[z-a]", false],
  ])("matches %s against %s: %s", (path, pattern, expected) => {
    expect(matchGlob(path, pattern)).toBe(expected);
  });

  it("handles nested alternatives without enumerating combinations", () => {
    expect(matchGlob("file.txt", "{".repeat(100) + "file.txt" + ",other}".repeat(100))).toBe(true);
  });
});

describe("textFormat", () => {
  it.each([
    ["", false, "none"],
    ["\uFEFF", true, "none"],
    ["hello", false, "none"],
    ["hello\uFEFF", false, "none"],
    ["hello\n", false, "LF"],
    ["\uFEFFhello\r\nworld\r\n", true, "CRLF"],
    ["hello\rworld\r", false, "CR"],
    ["a\r\nb\n", false, "mixed"],
    ["a\rb\n", false, "mixed"],
    ["a\r\nb\r", false, "mixed"],
  ])("identifies format without normalizing %j", (content, bom, endings) => {
    expect(textFormat(content)).toEqual({ utf8_bom: bom, line_endings: endings });
  });
});
