/**
 * A tolerant JSON reader for model output. Strict JSON is tried first; this
 * parser accepts the slips language models make when they think in
 * JavaScript: comments, trailing commas, single-quoted strings, unquoted keys,
 * `undefined`/`NaN`/`Infinity` (read as null), and string concatenation with
 * `+`. It never evaluates anything: the result is plain data.
 */

export class LooseJsonError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} at position ${position}`);
    this.name = "LooseJsonError";
    this.position = position;
  }
}

const MAX_DEPTH = 64;

class Reader {
  private index = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  parse(): unknown {
    this.skipTrivia();
    const value = this.value(0);
    this.skipTrivia();
    if (this.index < this.text.length) this.fail("Unexpected trailing content");
    return value;
  }

  private fail(message: string): never {
    throw new LooseJsonError(message, this.index);
  }

  private peek(): string {
    return this.text[this.index] ?? "";
  }

  private skipTrivia(): void {
    for (;;) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === " " || ch === "﻿") {
        this.index++;
      } else if (ch === "/" && this.text[this.index + 1] === "/") {
        while (this.index < this.text.length && this.text[this.index] !== "\n") this.index++;
      } else if (ch === "/" && this.text[this.index + 1] === "*") {
        const end = this.text.indexOf("*/", this.index + 2);
        this.index = end === -1 ? this.text.length : end + 2;
      } else {
        return;
      }
    }
  }

  private value(depth: number): unknown {
    if (depth > MAX_DEPTH) this.fail("Nesting too deep");
    const ch = this.peek();
    if (ch === "{") return this.object(depth);
    if (ch === "[") return this.array(depth);
    if (ch === '"' || ch === "'" || ch === "`") return this.stringExpression();
    if (ch === "-" || ch === "+" || ch === "." || (ch >= "0" && ch <= "9")) return this.number();
    return this.word();
  }

  private object(depth: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.index++; // {
    for (;;) {
      this.skipTrivia();
      if (this.peek() === "}") {
        this.index++;
        return out;
      }
      if (this.index >= this.text.length) this.fail("Unterminated object");
      const key = this.key();
      this.skipTrivia();
      if (this.peek() !== ":") this.fail('Expected ":" after key');
      this.index++;
      this.skipTrivia();
      out[key] = this.value(depth + 1);
      this.skipTrivia();
      if (this.peek() === ",") {
        this.index++;
        continue;
      }
      if (this.peek() === "}") continue;
      this.fail('Expected "," or "}" in object');
    }
  }

  private array(depth: number): unknown[] {
    const out: unknown[] = [];
    this.index++; // [
    for (;;) {
      this.skipTrivia();
      if (this.peek() === "]") {
        this.index++;
        return out;
      }
      if (this.index >= this.text.length) this.fail("Unterminated array");
      out.push(this.value(depth + 1));
      this.skipTrivia();
      if (this.peek() === ",") {
        this.index++;
        continue;
      }
      if (this.peek() === "]") continue;
      this.fail('Expected "," or "]" in array');
    }
  }

  private key(): string {
    const ch = this.peek();
    if (ch === '"' || ch === "'") return this.string();
    const start = this.index;
    while (/[A-Za-z0-9_$-]/.test(this.peek())) this.index++;
    if (start === this.index) this.fail("Expected a property name");
    return this.text.slice(start, this.index);
  }

  /** One string, or several joined with `+`. */
  private stringExpression(): string {
    let value = this.string();
    for (;;) {
      const save = this.index;
      this.skipTrivia();
      if (this.peek() !== "+") {
        this.index = save;
        return value;
      }
      this.index++;
      this.skipTrivia();
      const ch = this.peek();
      if (ch !== '"' && ch !== "'" && ch !== "`") this.fail("Only strings can be joined with +");
      value += this.string();
    }
  }

  private string(): string {
    const quote = this.peek();
    this.index++;
    let out = "";
    for (;;) {
      if (this.index >= this.text.length) this.fail("Unterminated string");
      const ch = this.text[this.index++];
      if (ch === quote) return out;
      if (ch === "\\") {
        const next = this.text[this.index++];
        switch (next) {
          case "n":
            out += "\n";
            break;
          case "t":
            out += "\t";
            break;
          case "r":
            out += "\r";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "u": {
            const hex = this.text.slice(this.index, this.index + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("Invalid unicode escape");
            out += String.fromCharCode(Number.parseInt(hex, 16));
            this.index += 4;
            break;
          }
          case "\n":
            break; // line continuation
          default:
            out += next ?? "";
        }
        continue;
      }
      if (ch === "\n" && quote !== "`") {
        // Models sometimes break long strings across lines; keep the text readable.
        out += " ";
        continue;
      }
      out += ch;
    }
  }

  private number(): number {
    const start = this.index;
    if (this.peek() === "+" || this.peek() === "-") this.index++;
    while (/[0-9._eE+-]/.test(this.peek())) {
      // Stop a trailing sign that belongs to the next token (`1 +` concatenation is strings only).
      if ((this.peek() === "+" || this.peek() === "-") && !/[eE]/.test(this.text[this.index - 1] ?? "")) break;
      this.index++;
    }
    const raw = this.text.slice(start, this.index).replace(/_/g, "");
    const value = Number(raw);
    if (raw === "" || raw === "+" || raw === "-" || !Number.isFinite(value)) {
      this.index = start;
      this.fail("Invalid number");
    }
    return value;
  }

  private word(): unknown {
    const start = this.index;
    while (/[A-Za-z_$]/.test(this.peek())) this.index++;
    const word = this.text.slice(start, this.index);
    switch (word) {
      case "true":
        return true;
      case "false":
        return false;
      case "null":
      case "undefined":
      case "NaN":
      case "Infinity":
        return null;
      case "":
        this.fail(this.index >= this.text.length ? "Unexpected end of input" : `Unexpected character "${this.peek()}"`);
      // falls through
      default:
        this.index = start;
        this.fail(`Unexpected word "${word}"`);
    }
  }
}

/** Parse strict JSON, or near-JSON with the common model slips. Throws {@link LooseJsonError}. */
export function parseLooseJson(text: string): unknown {
  let source = text.trim();
  // A stray fence label or wrapper the model sometimes leaves in.
  source = source.replace(/^(?:json|ui)\s*\n/i, "").replace(/^```(?:json|ui)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(source);
  } catch {
    return new Reader(source).parse();
  }
}

/**
 * Close a document that is still streaming: cut it at the last point where
 * every value is complete, then close the open arrays and objects. Returns
 * null when nothing complete exists yet. The result is a valid prefix of the
 * final document, so the host can render structure while the rest arrives.
 */
export function completePartialJson(text: string): string | null {
  const source = text.replace(/^```(?:json|ui)?\s*/, "");
  const stack: ("{" | "[")[] = [];
  const expectKey: boolean[] = [];
  let inString = false;
  let escape = false;
  let quote = "";
  let stringIsKey = false;
  let safeEnd = 0;
  let safeStack: ("{" | "[")[] = [];
  const markSafe = (position: number) => {
    safeEnd = position;
    safeStack = [...stack];
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === quote) {
        inString = false;
        if (!stringIsKey) markSafe(i + 1);
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      const top = stack[stack.length - 1];
      stringIsKey = top === "{" && expectKey[expectKey.length - 1];
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      expectKey.push(ch === "{");
      markSafe(i + 1);
      continue;
    }
    if (ch === "}" || ch === "]") {
      if (!stack.length) break;
      stack.pop();
      expectKey.pop();
      markSafe(i + 1);
      continue;
    }
    if (ch === ":") {
      if (expectKey.length) expectKey[expectKey.length - 1] = false;
      continue;
    }
    if (ch === ",") {
      markSafe(i);
      if (expectKey.length && stack[stack.length - 1] === "{") expectKey[expectKey.length - 1] = true;
      continue;
    }
  }
  if (safeEnd === 0) return null;
  let out = source.slice(0, safeEnd);
  for (let i = safeStack.length - 1; i >= 0; i--) out += safeStack[i] === "{" ? "}" : "]";
  // An element whose first key was cut off is an empty object at the tail; drop it.
  for (;;) {
    const trimmed = out.replace(/,\s*\{\s*\}(\s*\])/g, "$1").replace(/\[\s*\{\s*\}\s*\]/g, "[]");
    if (trimmed === out) return out;
    out = trimmed;
  }
}
