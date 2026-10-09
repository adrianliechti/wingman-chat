import { describe, expect, it, vi } from "vitest";
import {
  evaluate,
  ExpressionError,
  extendScope,
  formatValue,
  referencedIdentifiers,
  resolveTemplate,
  validateExpression,
} from "./expression";

describe("evaluate", () => {
  it("handles arithmetic with precedence and exponentiation", () => {
    expect(evaluate("1 + 2 * 3", {})).toBe(7);
    expect(evaluate("(1 + 2) * 3", {})).toBe(9);
    expect(evaluate("2 ^ 3 ^ 2", {})).toBe(512);
    expect(evaluate("2 ** 10", {})).toBe(1024);
    expect(evaluate("-x + 1", { x: 4 })).toBe(-3);
    expect(evaluate("10 % 4", {})).toBe(2);
  });

  it("reads state, members and indexes", () => {
    const scope = { user: { name: "Ada", tags: ["a", "b"] }, rows: [{ v: 1 }, { v: 2 }] };
    expect(evaluate("user.name", scope)).toBe("Ada");
    expect(evaluate("user.tags[1]", scope)).toBe("b");
    expect(evaluate("rows[1].v + rows[0].v", scope)).toBe(3);
    expect(evaluate("rows.length", scope)).toBe(2);
    expect(evaluate("missing", scope)).toBeUndefined();
    expect(evaluate("user.missing.deeper", scope)).toBeUndefined();
  });

  it("never reaches prototypes or globals", () => {
    expect(evaluate("user.constructor", { user: {} })).toBeUndefined();
    expect(evaluate("user.__proto__", { user: {} })).toBeUndefined();
    expect(evaluate("toString", { user: {} })).toBeUndefined();
    expect(() => evaluate("alert('x')", {})).toThrow(ExpressionError);
    expect(evaluate("Math.max(1, 2)", {})).toBe(2);
    expect(evaluate("Math.round(2.4)", {})).toBe(2);
    expect(evaluate("Math.random()", {})).toBeLessThan(1);
    expect(() => evaluate("Math.imul(1, 2)", {})).toThrow(/Unknown function/);
    expect(() => evaluate("user.toString()", { user: {} })).toThrow(ExpressionError);
  });

  it("supports comparison, logic and the conditional operator", () => {
    expect(evaluate("a > 2 && b < 5", { a: 3, b: 4 })).toBe(true);
    expect(evaluate("a == '3'", { a: 3 })).toBe(true);
    expect(evaluate("a != 3", { a: 3 })).toBe(false);
    expect(evaluate("x ? 'yes' : 'no'", { x: 0 })).toBe("no");
    expect(evaluate("missing ?? 'fallback'", {})).toBe("fallback");
    expect(evaluate("!done", { done: false })).toBe(true);
    expect(evaluate("'b' > 'a'", {})).toBe(true);
  });

  it("concatenates strings and divides safely", () => {
    expect(evaluate("'Total: ' + total", { total: 5 })).toBe("Total: 5");
    expect(evaluate("10 / 0", {})).toBe(0);
    expect(evaluate("'5' * 2", {})).toBe(10);
  });

  it("exposes math and collection helpers", () => {
    expect(evaluate("round(3.14159, 2)", {})).toBe(3.14);
    expect(evaluate("sum(items)", { items: [1, 2, 3] })).toBe(6);
    expect(evaluate("avg([2, 4])", {})).toBe(3);
    expect(evaluate("min(items)", { items: [5, 2, 9] })).toBe(2);
    expect(evaluate("max(1, 7, 3)", {})).toBe(7);
    expect(evaluate("clamp(15, 0, 10)", {})).toBe(10);
    expect(evaluate("len(items)", { items: [1, 2] })).toBe(2);
    expect(evaluate("range(3)", {})).toEqual([0, 1, 2]);
    expect(evaluate("range(1, 10, 4)", {})).toEqual([1, 5, 9]);
  });

  it("offers randomness and histograms for simulations", () => {
    const r = evaluate("random(5, 10)", {}) as number;
    expect(r).toBeGreaterThanOrEqual(5);
    expect(r).toBeLessThan(10);
    expect(evaluate("len(map(range(20), 'random()'))", {})).toBe(20);
    expect(evaluate("histogram([1, 2, 2, 3, 9], 4, 0, 8)", {})).toEqual([
      { bin: 0, count: 1 },
      { bin: 2, count: 3 },
      { bin: 4, count: 0 },
      { bin: 6, count: 1 },
    ]);
    expect(evaluate("histogram([], 3)", {})).toEqual([]);
  });

  it("iterates with nested expression strings", () => {
    const scope = {
      rows: [
        { n: "a", v: 1 },
        { n: "b", v: 5 },
        { n: "c", v: 3 },
      ],
      threshold: 2,
    };
    expect(evaluate("map(rows, 'v * 2')", scope)).toEqual([2, 10, 6]);
    expect(evaluate("map(rows, 'item.v + index')", scope)).toEqual([1, 6, 5]);
    expect(evaluate("pluck(filter(rows, 'v > threshold'), 'n')", scope)).toEqual(["b", "c"]);
    expect(evaluate("sortBy(rows, 'v', 'desc')[0].n", scope)).toBe("b");
    expect(evaluate("find(rows, 'n == \"c\"').v", scope)).toBe(3);
    expect(evaluate("join(pluck(rows, 'n'), '/')", scope)).toBe("a/b/c");
    expect(evaluate("sum(pluck(rows, 'v'))", scope)).toBe(9);
  });

  it("stops collection searches as soon as their result is known", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      expect(evaluate("find(range(10000), 'random() > 0')", {})).toBe(0);
      expect(random).toHaveBeenCalledTimes(1);
      random.mockClear();
      expect(evaluate("some(range(10000), 'random() > 0')", {})).toBe(true);
      expect(random).toHaveBeenCalledTimes(1);
      random.mockClear();
      expect(evaluate("every(range(10000), 'random() < 0')", {})).toBe(false);
      expect(random).toHaveBeenCalledTimes(1);
    } finally {
      random.mockRestore();
    }
  });

  it("formats numbers", () => {
    expect(evaluate("fixed(2.5, 2)", {})).toBe("2.50");
    expect(formatValue(1234.5, "number")).toMatch(/1,234\.5|1.234,5|1’234\.5|1 234,5/);
    expect(formatValue(0.5, "percent")).toMatch(/0\.5\s?%|0,5\s?%/);
    expect(formatValue(12.5, "percent", 0)).toMatch(/13\s?%/);
    expect(formatValue(1500000, "compact")).toMatch(/1\.5M|1,5 Mio|1,5 M/);
    expect(formatValue(42, "currency", 0, "EUR")).toMatch(/€|EUR/);
    expect(formatValue("", "number")).toBe("");
    expect(formatValue("n/a", "number")).toBe("n/a");
  });

  it("reports syntax errors", () => {
    expect(() => evaluate("1 +", {})).toThrow(ExpressionError);
    expect(() => evaluate("foo(", {})).toThrow(ExpressionError);
    expect(() => evaluate("'open", {})).toThrow(ExpressionError);
    expect(() => evaluate("a # b", {})).toThrow(/Unexpected character/);
  });

  it("limits nesting depth", () => {
    const deep = `${"(".repeat(100)}1${")".repeat(100)}`;
    expect(() => evaluate(deep, {})).toThrow(/nested too deeply/);
  });
});

describe("resolveTemplate", () => {
  it("interpolates text and returns raw values for whole templates", () => {
    const scope = { name: "Ada", rows: [1, 2], n: 2.5 };
    expect(resolveTemplate("Hello {{ name }}!", scope)).toBe("Hello Ada!");
    expect(resolveTemplate("{{ rows }}", scope)).toEqual([1, 2]);
    expect(resolveTemplate("{{ n * 2 }}", scope)).toBe(5);
    expect(resolveTemplate("{{ n }} and {{ name }}", scope)).toBe("2.5 and Ada");
    expect(resolveTemplate("plain", scope)).toBe("plain");
    expect(resolveTemplate(42, scope)).toBe(42);
  });
});

describe("referencedIdentifiers", () => {
  it("collects free identifiers", () => {
    expect([...referencedIdentifiers("a + b.c * round(d, 2)")].sort()).toEqual(["a", "b", "d"]);
    expect([...referencedIdentifiers("bad +")]).toEqual([]);
    expect([...referencedIdentifiers("{{ a }} and {{ b.c }}")].sort()).toEqual(["a", "b"]);
  });
});

describe("validateExpression", () => {
  it("accepts sound expressions and templates", () => {
    expect(validateExpression("round(a * b, 2)")).toBeNull();
    expect(validateExpression("{{ a }} of {{ sum(map(rows, 'item.v * 2')) }}")).toBeNull();
    expect(validateExpression("sortBy(rows, 'price', 'desc')")).toBeNull();
    expect(validateExpression("Math.max(a, 1)")).toBeNull();
  });

  it("reports syntax errors and unknown functions, nested expressions included", () => {
    expect(validateExpression("a +")).toMatch(/Unexpected end/);
    expect(validateExpression("toFixed(a)")).toBe('Unknown function "toFixed"');
    expect(validateExpression("{{ ok }} {{ a.toFixed(2) }}")).toMatch(/Unexpected token/);
    expect(validateExpression("map(rows, 'item.v +')")).toMatch(/^in map: Unexpected end/);
    expect(validateExpression("filter(rows, 'nope(item)')")).toBe('in filter: Unknown function "nope"');
  });
});

describe("extendScope", () => {
  it("reads extra values first and falls back to the base scope", () => {
    const scope = extendScope({ a: 1, item: "base" }, { item: { v: 2 }, index: 0 });
    expect(evaluate("a + item.v + index", scope)).toBe(3);
    expect(evaluate("item.v", extendScope(scope, { item: { v: 5 } }))).toBe(5);
  });
});
