/**
 * A small, safe expression language for Intelligent UI documents.
 *
 * The model binds controls to state and derives values with expressions such as
 * `principal * rate / 1200` or `round(total * 1.08, 2)`. Expressions are parsed
 * into an AST and evaluated against a plain scope object; nothing is compiled
 * to JavaScript, so a generated document can never run arbitrary code, reach
 * the DOM, or touch globals. The grammar covers arithmetic, comparison, logic,
 * the conditional operator, member/index access, and calls to a fixed set of
 * pure helpers.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type Scope = Record<string, unknown>;

export class ExpressionError extends Error {
  readonly position?: number;

  constructor(message: string, position?: number) {
    super(message);
    this.name = "ExpressionError";
    this.position = position;
  }
}

// ── Tokenizer ──────────────────────────────────────────────────────────────

type Token =
  | { kind: "number"; value: number; pos: number }
  | { kind: "string"; value: string; pos: number }
  | { kind: "ident"; value: string; pos: number }
  | { kind: "op"; value: string; pos: number }
  | { kind: "end"; pos: number };

const OPERATORS = [
  "===",
  "!==",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "**",
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "<",
  ">",
  "!",
  "?",
  ":",
  "(",
  ")",
  "[",
  "]",
  ",",
  ".",
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || (ch === "." && source[i + 1] >= "0" && source[i + 1] <= "9")) {
      const start = i;
      while (i < source.length && ((source[i] >= "0" && source[i] <= "9") || source[i] === "." || source[i] === "_"))
        i++;
      if (source[i] === "e" || source[i] === "E") {
        i++;
        if (source[i] === "+" || source[i] === "-") i++;
        while (i < source.length && source[i] >= "0" && source[i] <= "9") i++;
      }
      const text = source.slice(start, i).replace(/_/g, "");
      const value = Number(text);
      if (!Number.isFinite(value)) throw new ExpressionError(`Invalid number "${text}"`, start);
      tokens.push({ kind: "number", value, pos: start });
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i;
      let value = "";
      i++;
      let closed = false;
      while (i < source.length) {
        const c = source[i];
        if (c === "\\") {
          const next = source[i + 1];
          value += next === "n" ? "\n" : next === "t" ? "\t" : (next ?? "");
          i += 2;
          continue;
        }
        if (c === ch) {
          closed = true;
          i++;
          break;
        }
        value += c;
        i++;
      }
      if (!closed) throw new ExpressionError("Unterminated string", start);
      tokens.push({ kind: "string", value, pos: start });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i++;
      tokens.push({ kind: "ident", value: source.slice(start, i), pos: start });
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (!op) throw new ExpressionError(`Unexpected character "${ch}"`, i);
    tokens.push({ kind: "op", value: op, pos: i });
    i += op.length;
  }
  tokens.push({ kind: "end", pos: source.length });
  return tokens;
}

// ── Parser ─────────────────────────────────────────────────────────────────

export type Node =
  | { type: "literal"; value: JsonValue }
  | { type: "ident"; name: string }
  | { type: "member"; object: Node; property: string }
  | { type: "index"; object: Node; index: Node }
  | { type: "call"; callee: string; args: Node[] }
  | { type: "unary"; op: "-" | "!" | "+"; operand: Node }
  | { type: "binary"; op: string; left: Node; right: Node }
  | { type: "logical"; op: "&&" | "||" | "??"; left: Node; right: Node }
  | { type: "conditional"; test: Node; consequent: Node; alternate: Node }
  | { type: "array"; items: Node[] };

const BINARY_PRECEDENCE: Record<string, number> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "==": 7,
  "!=": 7,
  "===": 7,
  "!==": 7,
  "<": 8,
  ">": 8,
  "<=": 8,
  ">=": 8,
  "+": 9,
  "-": 9,
  "*": 10,
  "/": 10,
  "%": 10,
  "**": 12,
  "^": 12,
};

const MAX_DEPTH = 64;

class Parser {
  private index = 0;
  private depth = 0;

  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Node {
    const node = this.parseConditional();
    const token = this.peek();
    if (token.kind !== "end") throw new ExpressionError(`Unexpected token "${tokenText(token)}"`, token.pos);
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    return this.tokens[this.index++];
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token.kind === "op" && token.value === value;
  }

  private expectOp(value: string): void {
    const token = this.next();
    if (token.kind !== "op" || token.value !== value) {
      throw new ExpressionError(`Expected "${value}" but found "${tokenText(token)}"`, token.pos);
    }
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) throw new ExpressionError("Expression is nested too deeply");
  }

  private leave(): void {
    this.depth--;
  }

  private parseConditional(): Node {
    this.enter();
    try {
      const test = this.parseBinary(0);
      if (!this.isOp("?")) return test;
      this.next();
      const consequent = this.parseConditional();
      this.expectOp(":");
      const alternate = this.parseConditional();
      return { type: "conditional", test, consequent, alternate };
    } finally {
      this.leave();
    }
  }

  private parseBinary(minPrecedence: number): Node {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token.kind !== "op") break;
      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      this.next();
      // Exponentiation is right-associative; everything else is left-associative.
      const rightAssociative = token.value === "**" || token.value === "^";
      const right = this.parseBinary(rightAssociative ? precedence : precedence + 1);
      left =
        token.value === "&&" || token.value === "||" || token.value === "??"
          ? { type: "logical", op: token.value, left, right }
          : { type: "binary", op: token.value, left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    const token = this.peek();
    if (token.kind === "op" && (token.value === "-" || token.value === "!" || token.value === "+")) {
      this.next();
      this.enter();
      try {
        return { type: "unary", op: token.value, operand: this.parseUnary() };
      } finally {
        this.leave();
      }
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    for (;;) {
      if (this.isOp(".")) {
        this.next();
        const token = this.next();
        if (token.kind !== "ident") throw new ExpressionError("Expected a property name", token.pos);
        node = { type: "member", object: node, property: token.value };
        continue;
      }
      if (this.isOp("[")) {
        this.next();
        const index = this.parseConditional();
        this.expectOp("]");
        node = { type: "index", object: node, index };
        continue;
      }
      // `Math.round(x)` is a common habit; route it to the helper of the same name.
      if (this.isOp("(") && node.type === "member" && node.object.type === "ident" && node.object.name === "Math") {
        this.next();
        const args: Node[] = [];
        if (!this.isOp(")")) {
          for (;;) {
            args.push(this.parseConditional());
            if (this.isOp(",")) {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expectOp(")");
        node = { type: "call", callee: node.property, args };
        continue;
      }
      break;
    }
    return node;
  }

  private parsePrimary(): Node {
    const token = this.next();
    switch (token.kind) {
      case "number":
        return { type: "literal", value: token.value };
      case "string":
        return { type: "literal", value: token.value };
      case "ident": {
        if (token.value === "true") return { type: "literal", value: true };
        if (token.value === "false") return { type: "literal", value: false };
        if (token.value === "null" || token.value === "undefined") return { type: "literal", value: null };
        if (this.isOp("(")) {
          this.next();
          const args: Node[] = [];
          if (!this.isOp(")")) {
            for (;;) {
              args.push(this.parseConditional());
              if (this.isOp(",")) {
                this.next();
                continue;
              }
              break;
            }
          }
          this.expectOp(")");
          return { type: "call", callee: token.value, args };
        }
        return { type: "ident", name: token.value };
      }
      case "op":
        if (token.value === "(") {
          const node = this.parseConditional();
          this.expectOp(")");
          return node;
        }
        if (token.value === "[") {
          const items: Node[] = [];
          if (!this.isOp("]")) {
            for (;;) {
              items.push(this.parseConditional());
              if (this.isOp(",")) {
                this.next();
                continue;
              }
              break;
            }
          }
          this.expectOp("]");
          return { type: "array", items };
        }
        throw new ExpressionError(`Unexpected token "${token.value}"`, token.pos);
      case "end":
        throw new ExpressionError("Unexpected end of expression", token.pos);
    }
  }
}

function tokenText(token: Token): string {
  switch (token.kind) {
    case "end":
      return "end of expression";
    case "number":
      return String(token.value);
    default:
      return token.value;
  }
}

const parseCache = new Map<string, Node>();
const MAX_PARSE_CACHE = 500;

export function parseExpression(source: string): Node {
  const cached = parseCache.get(source);
  if (cached) return cached;
  const node = new Parser(tokenize(source)).parse();
  if (parseCache.size >= MAX_PARSE_CACHE) parseCache.delete(parseCache.keys().next().value as string);
  parseCache.set(source, node);
  return node;
}

// ── Helpers available to expressions ───────────────────────────────────────

const MAX_COLLECTION = 10_000;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.length > MAX_COLLECTION ? value.slice(0, MAX_COLLECTION) : value;
  if (value === null || value === undefined) return [];
  if (typeof value === "object") return Object.values(value);
  return [value];
}

function numbers(value: unknown): number[] {
  return toArray(value)
    .map(toNumber)
    .filter((n) => Number.isFinite(n));
}

/** Evaluate a nested expression (a string) once per item, with `item`/`index`/`key` in scope. */
function iterate(scope: Scope, items: unknown[], expression: unknown, extra?: (item: unknown) => Scope) {
  const node = typeof expression === "string" ? parseExpression(expression) : null;
  return items.map((item, index) => {
    if (!node) return expression;
    const child: Scope = Object.create(scope);
    child.item = item;
    child.index = index;
    if (item && typeof item === "object") Object.assign(child, item);
    if (extra) Object.assign(child, extra(item));
    return evaluateNode(node, child);
  });
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const an = toNumber(a);
  const bn = toNumber(b);
  if (Number.isFinite(an) && Number.isFinite(bn) && a !== "" && b !== "") return an - bn;
  return stringify(a).localeCompare(stringify(b));
}

type Helper = (scope: Scope, args: unknown[]) => unknown;

const HELPERS: Record<string, Helper> = {
  // Math
  abs: (_, [x]) => Math.abs(toNumber(x)),
  round: (_, [x, digits]) => {
    const factor = 10 ** Math.max(0, Math.min(12, Math.trunc(toNumber(digits ?? 0))));
    return Math.round(toNumber(x) * factor) / factor;
  },
  floor: (_, [x]) => Math.floor(toNumber(x)),
  ceil: (_, [x]) => Math.ceil(toNumber(x)),
  trunc: (_, [x]) => Math.trunc(toNumber(x)),
  sqrt: (_, [x]) => Math.sqrt(toNumber(x)),
  pow: (_, [x, y]) => toNumber(x) ** toNumber(y),
  log: (_, [x, base]) =>
    base === undefined ? Math.log(toNumber(x)) : Math.log(toNumber(x)) / Math.log(toNumber(base)),
  exp: (_, [x]) => Math.exp(toNumber(x)),
  min: (_, args) => Math.min(...(args.length === 1 ? numbers(args[0]) : numbers(args))),
  max: (_, args) => Math.max(...(args.length === 1 ? numbers(args[0]) : numbers(args))),
  clamp: (_, [x, lo, hi]) => Math.min(Math.max(toNumber(x), toNumber(lo)), toNumber(hi)),
  sum: (_, [xs]) => numbers(xs).reduce((acc, n) => acc + n, 0),
  avg: (_, [xs]) => {
    const values = numbers(xs);
    return values.length ? values.reduce((acc, n) => acc + n, 0) / values.length : 0;
  },
  number: (_, [x]) => {
    const n = toNumber(x);
    return Number.isFinite(n) ? n : 0;
  },
  isFinite: (_, [x]) => Number.isFinite(toNumber(x)),
  // Randomness re-rolls on every evaluation, so it belongs in button actions, not computed values.
  random: (_, [lo, hi]) => {
    if (lo === undefined) return Math.random();
    const from = hi === undefined ? 0 : toNumber(lo);
    const to = hi === undefined ? toNumber(lo) : toNumber(hi);
    return from + Math.random() * (to - from);
  },
  histogram: (_, [xs, bins, lo, hi]) => {
    const values = numbers(xs);
    const count = Math.max(1, Math.min(200, Math.trunc(toNumber(bins ?? 10))));
    if (!values.length) return [];
    const min = lo === undefined ? Math.min(...values) : toNumber(lo);
    const max = hi === undefined ? Math.max(...values) : toNumber(hi);
    const width = max > min ? (max - min) / count : 1;
    const out = Array.from({ length: count }, (_, i) => ({
      bin: Number((min + i * width).toPrecision(6)),
      count: 0,
    }));
    for (const v of values) {
      const index = Math.min(count - 1, Math.max(0, Math.floor((v - min) / width)));
      out[index].count++;
    }
    return out;
  },
  // Collections
  len: (_, [x]) => (typeof x === "string" ? x.length : toArray(x).length),
  count: (_, [x]) => (typeof x === "string" ? x.length : toArray(x).length),
  range: (_, [start, end, step]) => {
    const from = end === undefined ? 0 : toNumber(start);
    const to = end === undefined ? toNumber(start) : toNumber(end);
    const by = step === undefined ? 1 : toNumber(step);
    if (!by || !Number.isFinite(from) || !Number.isFinite(to)) return [];
    const out: number[] = [];
    for (let v = from; by > 0 ? v < to : v > to; v += by) {
      if (out.length >= MAX_COLLECTION) break;
      out.push(v);
    }
    return out;
  },
  map: (scope, [xs, expr]) => iterate(scope, toArray(xs), expr),
  filter: (scope, [xs, expr]) => {
    const items = toArray(xs);
    const keep = iterate(scope, items, expr);
    return items.filter((_, i) => truthy(keep[i]));
  },
  find: (scope, [xs, expr]) => {
    const items = toArray(xs);
    const keep = iterate(scope, items, expr);
    const index = keep.findIndex(truthy);
    return index >= 0 ? items[index] : null;
  },
  some: (scope, [xs, expr]) => iterate(scope, toArray(xs), expr).some(truthy),
  every: (scope, [xs, expr]) => iterate(scope, toArray(xs), expr).every(truthy),
  pluck: (_, [xs, key]) => toArray(xs).map((item) => readProperty(item, String(key))),
  sortBy: (scope, [xs, keyOrExpr, direction]) => {
    const items = toArray(xs);
    const keys =
      typeof keyOrExpr === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(keyOrExpr)
        ? items.map((item) => readProperty(item, keyOrExpr))
        : iterate(scope, items, keyOrExpr);
    const sign = stringify(direction ?? "asc").toLowerCase() === "desc" ? -1 : 1;
    return items
      .map((item, i) => ({ item, key: keys[i] }))
      .sort((a, b) => sign * compare(a.key, b.key))
      .map((entry) => entry.item);
  },
  reverse: (_, [xs]) => [...toArray(xs)].reverse(),
  slice: (_, [xs, start, end]) =>
    toArray(xs).slice(toNumber(start ?? 0), end === undefined ? undefined : toNumber(end)),
  first: (_, [xs]) => toArray(xs)[0] ?? null,
  last: (_, [xs]) => toArray(xs).at(-1) ?? null,
  includes: (_, [xs, value]) => (typeof xs === "string" ? xs.includes(String(value)) : toArray(xs).includes(value)),
  indexOf: (_, [xs, value]) => (typeof xs === "string" ? xs.indexOf(String(value)) : toArray(xs).indexOf(value)),
  join: (_, [xs, separator]) =>
    toArray(xs)
      .map(stringify)
      .join(separator === undefined ? ", " : stringify(separator)),
  keys: (_, [x]) => (x && typeof x === "object" ? Object.keys(x) : []),
  values: (_, [x]) => (x && typeof x === "object" ? Object.values(x) : []),
  get: (_, [x, path, fallback]) => {
    const value = stringify(path)
      .split(".")
      .reduce<unknown>((acc, key) => readProperty(acc, key), x);
    return value === undefined || value === null ? (fallback ?? null) : value;
  },
  // Strings
  upper: (_, [s]) => stringify(s).toUpperCase(),
  lower: (_, [s]) => stringify(s).toLowerCase(),
  trim: (_, [s]) => stringify(s).trim(),
  concat: (_, args) => args.map(stringify).join(""),
  split: (_, [s, separator]) => stringify(s).split(separator === undefined ? "," : stringify(separator)),
  replace: (_, [s, from, to]) => stringify(s).split(stringify(from)).join(stringify(to)),
  startsWith: (_, [s, prefix]) => stringify(s).startsWith(stringify(prefix)),
  endsWith: (_, [s, suffix]) => stringify(s).endsWith(stringify(suffix)),
  str: (_, [x]) => stringify(x),
  // Logic
  if: (_, [test, a, b]) => (truthy(test) ? a : (b ?? null)),
  coalesce: (_, args) => args.find((value) => value !== null && value !== undefined) ?? null,
  isEmpty: (_, [x]) =>
    x === null ||
    x === undefined ||
    x === "" ||
    (Array.isArray(x) && x.length === 0) ||
    (typeof x === "number" && Number.isNaN(x)),
  // Formatting
  format: (_, [x, style, digits, currency]) => formatValue(x, stringify(style ?? "number"), digits, currency),
  currency: (_, [x, code, digits]) => formatValue(x, "currency", digits, code),
  percent: (_, [x, digits]) => formatValue(x, "percent", digits),
  compact: (_, [x, digits]) => formatValue(x, "compact", digits),
  fixed: (_, [x, digits]) => toNumber(x).toFixed(Math.max(0, Math.min(20, Math.trunc(toNumber(digits ?? 2))))),
};

export const HELPER_NAMES = Object.keys(HELPERS);

/** Locale-aware number formatting shared by expressions and components. */
export function formatValue(value: unknown, style: string, digits?: unknown, currency?: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = toNumber(value);
  if (!Number.isFinite(n)) return stringify(value);
  const fractionDigits =
    digits === undefined || digits === null ? undefined : Math.max(0, Math.min(20, Math.trunc(toNumber(digits))));
  const locale = typeof navigator !== "undefined" ? navigator.language : "en-US";
  const options: Intl.NumberFormatOptions = {};
  switch (style) {
    case "currency":
      options.style = "currency";
      options.currency =
        typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "USD";
      break;
    case "percent":
      options.style = "percent";
      // Percent values are given as plain numbers (12.5 means 12.5%).
      return new Intl.NumberFormat(locale, {
        style: "percent",
        minimumFractionDigits: fractionDigits ?? 0,
        maximumFractionDigits: fractionDigits ?? 1,
      }).format(n / 100);
    case "compact":
      options.notation = "compact";
      break;
    case "integer":
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
    default:
      break;
  }
  if (fractionDigits !== undefined) {
    options.minimumFractionDigits = fractionDigits;
    options.maximumFractionDigits = fractionDigits;
  } else if (style !== "currency") {
    options.maximumFractionDigits = 2;
  }
  try {
    return new Intl.NumberFormat(locale, options).format(n);
  } catch {
    return String(n);
  }
}

export function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return !!value;
}

// Property reads never walk the prototype chain, so expressions cannot reach
// constructors, prototypes, or other inherited JavaScript machinery.
function readProperty(object: unknown, key: string): unknown {
  if (object === null || object === undefined) return undefined;
  if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
  if (typeof object === "string") {
    if (key === "length") return object.length;
    return undefined;
  }
  if (Array.isArray(object)) {
    if (key === "length") return object.length;
    const index = Number(key);
    return Number.isInteger(index) ? object[index] : undefined;
  }
  if (typeof object === "object") {
    return Object.hasOwn(object, key) ? (object as Record<string, unknown>)[key] : undefined;
  }
  return undefined;
}

function lookup(scope: Scope, name: string): unknown {
  // Iteration scopes inherit from the document scope, so walk own properties up
  // the chain, but stop before Object.prototype so `toString` is not a value.
  let current: object | null = scope;
  while (current && current !== Object.prototype) {
    if (Object.hasOwn(current, name)) return (current as Scope)[name];
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

// ── Evaluator ──────────────────────────────────────────────────────────────

export function evaluateNode(node: Node, scope: Scope): unknown {
  switch (node.type) {
    case "literal":
      return node.value;
    case "ident":
      return lookup(scope, node.name);
    case "array":
      return node.items.map((item) => evaluateNode(item, scope));
    case "member":
      return readProperty(evaluateNode(node.object, scope), node.property);
    case "index": {
      const index = evaluateNode(node.index, scope);
      return readProperty(evaluateNode(node.object, scope), stringify(index));
    }
    case "call": {
      const helper = Object.hasOwn(HELPERS, node.callee) ? HELPERS[node.callee] : undefined;
      if (!helper) throw new ExpressionError(`Unknown function "${node.callee}"`);
      return helper(
        scope,
        node.args.map((arg) => evaluateNode(arg, scope)),
      );
    }
    case "unary": {
      const value = evaluateNode(node.operand, scope);
      if (node.op === "!") return !truthy(value);
      if (node.op === "-") return -toNumber(value);
      return toNumber(value);
    }
    case "logical": {
      const left = evaluateNode(node.left, scope);
      if (node.op === "&&") return truthy(left) ? evaluateNode(node.right, scope) : left;
      if (node.op === "||") return truthy(left) ? left : evaluateNode(node.right, scope);
      return left === null || left === undefined ? evaluateNode(node.right, scope) : left;
    }
    case "conditional":
      return truthy(evaluateNode(node.test, scope))
        ? evaluateNode(node.consequent, scope)
        : evaluateNode(node.alternate, scope);
    case "binary": {
      const left = evaluateNode(node.left, scope);
      const right = evaluateNode(node.right, scope);
      switch (node.op) {
        case "+":
          if (typeof left === "string" || typeof right === "string") return stringify(left) + stringify(right);
          if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
          return toNumber(left) + toNumber(right);
        case "-":
          return toNumber(left) - toNumber(right);
        case "*":
          return toNumber(left) * toNumber(right);
        case "/": {
          const divisor = toNumber(right);
          return divisor === 0 ? 0 : toNumber(left) / divisor;
        }
        case "%": {
          const divisor = toNumber(right);
          return divisor === 0 ? 0 : toNumber(left) % divisor;
        }
        case "**":
        case "^":
          return toNumber(left) ** toNumber(right);
        case "==":
        case "===":
          return looseEquals(left, right);
        case "!=":
        case "!==":
          return !looseEquals(left, right);
        case "<":
          return compare(left, right) < 0;
        case ">":
          return compare(left, right) > 0;
        case "<=":
          return compare(left, right) <= 0;
        case ">=":
          return compare(left, right) >= 0;
        default:
          throw new ExpressionError(`Unknown operator "${node.op}"`);
      }
    }
  }
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (typeof a === "number" || typeof b === "number") {
    const an = toNumber(a);
    const bn = toNumber(b);
    return Number.isFinite(an) && Number.isFinite(bn) && an === bn && a !== "" && b !== "";
  }
  return stringify(a) === stringify(b);
}

/** Parse and evaluate `source` against `scope`. Throws {@link ExpressionError} on bad syntax. */
export function evaluate(source: string, scope: Scope): unknown {
  return evaluateNode(parseExpression(source), scope);
}

// ── Templates ──────────────────────────────────────────────────────────────

const TEMPLATE = /\{\{\s*([\s\S]+?)\s*\}\}/g;

export function isTemplate(value: unknown): value is string {
  return typeof value === "string" && value.includes("{{");
}

/**
 * Resolve `{{ expr }}` placeholders in a string. A string that is exactly one
 * placeholder yields the raw value (so `"{{ rows }}"` can supply an array);
 * otherwise placeholders are interpolated as text. Non-template values pass
 * through unchanged.
 */
export function resolveTemplate(value: unknown, scope: Scope): unknown {
  if (!isTemplate(value)) return value;
  const close = value.indexOf("}}");
  if (value.startsWith("{{") && close === value.length - 2 && value.indexOf("{{", 2) === -1) {
    return evaluate(value.slice(2, -2).trim(), scope);
  }
  return value.replace(TEMPLATE, (_, expression: string) => stringify(evaluate(expression, scope)));
}

/** Identifiers an expression reads, for dependency analysis in computed values. */
export function referencedIdentifiers(source: string): Set<string> {
  const names = new Set<string>();
  const visit = (node: Node) => {
    switch (node.type) {
      case "ident":
        names.add(node.name);
        break;
      case "member":
        visit(node.object);
        break;
      case "index":
        visit(node.object);
        visit(node.index);
        break;
      case "call":
        node.args.forEach(visit);
        // Nested expression strings inside map/filter/... are opaque here; their
        // free identifiers are resolved against the same scope at run time.
        break;
      case "unary":
        visit(node.operand);
        break;
      case "binary":
      case "logical":
        visit(node.left);
        visit(node.right);
        break;
      case "conditional":
        visit(node.test);
        visit(node.consequent);
        visit(node.alternate);
        break;
      case "array":
        node.items.forEach(visit);
        break;
      default:
        break;
    }
  };
  const expressions = isTemplate(source) ? [...source.matchAll(TEMPLATE)].map((match) => match[1]) : [source];
  for (const expression of expressions) {
    try {
      visit(parseExpression(expression));
    } catch {
      // Bad syntax surfaces when the value is evaluated.
    }
  }
  return names;
}
