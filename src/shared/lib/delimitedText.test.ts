import { describe, expect, it } from "vitest";
import { DelimitedTextResourceLimitError, detectDelimitedTextDelimiter, parseDelimitedText } from "./delimitedText";

describe("delimited text parsing", () => {
  it("parses quoted records without changing text-like values", () => {
    expect(parseDelimitedText('id,description\r\n00123,"first line\nsecond, line"\r\n"""quoted""",=1+1\r\n')).toEqual([
      ["id", "description"],
      ["00123", "first line\nsecond, line"],
      ['"quoted"', "=1+1"],
    ]);
  });

  it("normalizes CR and CRLF inside quotes while preserving fields and blank rows", () => {
    expect(parseDelimitedText('a,,c\r\n\r\n1,"first\rsecond"\r\n2,"third\r\nfourth"\r\n')).toEqual([
      ["a", "", "c"],
      [""],
      ["1", "first\nsecond"],
      ["2", "third\nfourth"],
    ]);
  });

  it("does not trim authored boundary whitespace", () => {
    expect(parseDelimitedText("  heading,value  ")).toEqual([["  heading", "value  "]]);
  });

  it("detects delimiters from a logical record and supports explicit TSV", () => {
    expect(detectDelimitedTextDelimiter('"multi\nline";value\nnext;row')).toBe(";");
    expect(parseDelimitedText("left\tright", { delimiter: "\t" })).toEqual([["left", "right"]]);
  });

  it("rejects malformed quoted fields", () => {
    expect(() => parseDelimitedText('a,"unterminated')).toThrow("Unterminated quoted field");
    expect(() => parseDelimitedText('a,"closed"tail')).toThrow("Unexpected character after closing quote");
  });

  it("enforces source, row, column, cell, and retained-text limits", () => {
    expect(() => parseDelimitedText("abc", { limits: { maxSourceCharacters: 2 } })).toThrow(
      DelimitedTextResourceLimitError,
    );
    expect(() => parseDelimitedText("a\nb", { limits: { maxRows: 1 } })).toThrow("1-row limit");
    expect(() => parseDelimitedText("a,b", { limits: { maxColumns: 1 } })).toThrow("1-column limit");
    expect(() => parseDelimitedText("a,b", { limits: { maxCells: 1 } })).toThrow("1-cell limit");
    expect(() => parseDelimitedText("abc", { limits: { maxRetainedCharacters: 2 } })).toThrow(
      "2-character retained-text limit",
    );
  });
});
