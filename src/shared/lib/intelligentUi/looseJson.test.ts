import { describe, expect, it } from "vitest";
import { completePartialJson, LooseJsonError, parseLooseJson } from "./looseJson";

describe("parseLooseJson", () => {
  it("parses strict JSON", () => {
    expect(parseLooseJson('{"a": [1, 2, {"b": null}], "c": "d"}')).toEqual({ a: [1, 2, { b: null }], c: "d" });
  });

  it("joins strings written with +", () => {
    expect(parseLooseJson('{"summary": "{{ guests }} guests · " + "{{ style }}"}')).toEqual({
      summary: "{{ guests }} guests · {{ style }}",
    });
    expect(parseLooseJson(`["a" +\n 'b' + \`c\`]`)).toEqual(["abc"]);
    expect(() => parseLooseJson('{"a": "x" + 1}')).toThrow(LooseJsonError);
  });

  it("accepts comments, trailing commas, unquoted keys and single quotes", () => {
    const text = `{
      // guests
      guests: 6, /* default */
      'style': 'cozy',
      list: [1, 2,],
    }`;
    expect(parseLooseJson(text)).toEqual({ guests: 6, style: "cozy", list: [1, 2] });
  });

  it("reads undefined, NaN and Infinity as null and keeps numbers", () => {
    expect(parseLooseJson("[undefined, NaN, Infinity, -2.5, +3, 1e3]")).toEqual([null, null, null, -2.5, 3, 1000]);
  });

  it("strips a stray fence label and handles escapes", () => {
    expect(parseLooseJson('json\n{"a": "line\\nbreak \\u00e9"}')).toEqual({ a: "line\nbreak é" });
    expect(parseLooseJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("reports where parsing failed", () => {
    expect(() => parseLooseJson('{"a": 1 "b": 2}')).toThrow(/Expected "," or "}"/);
    expect(() => parseLooseJson('{"a": ')).toThrow(/Unexpected end of input/);
    expect(() => parseLooseJson("{'a': 1} x")).toThrow(/trailing content/);
  });
});

describe("completePartialJson", () => {
  it("closes a streaming prefix at the last complete value", () => {
    expect(completePartialJson('{"state": {"a": 1, "b": 2')).toBe('{"state": {"a": 1}}');
    expect(completePartialJson('{"children": [{"type": "text", "text": "hi"}, {"type": "metr')).toBe(
      '{"children": [{"type": "text", "text": "hi"}]}',
    );
    expect(
      completePartialJson(
        '{"children": [{"type": "text", "text": "hi"}, {"type": "metric", "label": "x", "value": "{{ t',
      ),
    ).toBe('{"children": [{"type": "text", "text": "hi"}, {"type": "metric", "label": "x"}]}');
    expect(completePartialJson('{"title": "Loan", "state": {"principal": 25')).toBe('{"title": "Loan", "state": {}}');
    expect(completePartialJson('{"state": {"x": "a,b')).toBe('{"state": {}}');
  });

  it("returns null when nothing is complete and keeps whole documents", () => {
    expect(completePartialJson("")).toBeNull();
    expect(completePartialJson('{"chil')).toBe("{}");
    expect(completePartialJson('{"a": [1, 2]}')).toBe('{"a": [1, 2]}');
  });
});
