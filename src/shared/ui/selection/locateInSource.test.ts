import { describe, expect, it } from "vitest";
import { locateInSource } from "./locateInSource";

const source = "# Title\n\nQuarterly revenue grew.\nCosts fell.\n\nprint(x)\nprint(x)\n";

describe("locateInSource", () => {
  it("finds a unique passage and reports its lines", () => {
    expect(locateInSource(source, "Quarterly revenue grew.")).toEqual({ start: 3, end: 3 });
    expect(locateInSource(source, "revenue grew.\nCosts")).toEqual({ start: 3, end: 4 });
  });

  it("refuses passages that occur more than once or not at all", () => {
    expect(locateInSource(source, "print(x)")).toBeNull();
    expect(locateInSource(source, "Profit rose.")).toBeNull();
    expect(locateInSource(source, "   ")).toBeNull();
  });

  it("matches rendered text whose whitespace was collapsed", () => {
    expect(locateInSource("a\n\nQuarterly   revenue\ngrew a lot.\n", "Quarterly revenue grew a lot.")).toEqual({
      start: 3,
      end: 4,
    });
  });

  it("treats CRLF sources and selections alike", () => {
    expect(locateInSource("one\r\ntwo\r\nthree", "two\r\nthree")).toEqual({ start: 2, end: 3 });
  });
});
