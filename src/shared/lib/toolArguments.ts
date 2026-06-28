import { jsonrepair } from "jsonrepair";

/**
 * Thrown when tool-call arguments can't be parsed even after recovery.
 * Carries the raw string so callers can craft a model-facing error.
 */
export class ToolArgumentsParseError extends Error {
  /** The raw (un-recoverable) arguments string, retained for logging. */
  readonly raw: string;

  constructor(raw: string, reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.name = "ToolArgumentsParseError";
    this.raw = raw;
  }
}

/**
 * Hints derived from a tool's JSON-Schema that let the recovery path slice a
 * mis-escaped argument string. `payloadKey` is the field most likely to hold a
 * large free-text blob (source code, a shell command); `otherKeys` are the
 * remaining declared properties, used as structural boundaries.
 */
export interface ToolArgumentHints {
  payloadKey?: string;
  otherKeys?: string[];
}

// String fields whose name implies a code/command/text payload. When a tool has
// several string properties we only enable recovery if one of them matches —
// otherwise we can't tell which holds the blob and leave it to jsonrepair.
const PAYLOAD_NAME = /^(code|command|script|source|sql|query|content|body|text|input|patch|diff)$/i;

function asObject(value: unknown): Record<string, unknown> {
  // Tool arguments are always a JSON object. A bare array/number/string means
  // the model emitted something malformed enough that repair "succeeded" on the
  // wrong shape — treat that as a non-object and let callers see empty args.
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isStringType(schema: unknown): boolean {
  const type = (schema as { type?: unknown })?.type;
  return type === "string" || (Array.isArray(type) && type.includes("string"));
}

/**
 * Inspect a tool's JSON-Schema `parameters` and pick the field recovery should
 * target. Returns an empty object when no single payload field can be
 * identified, which keeps recovery off for tools where it might mis-target.
 */
export function toolArgumentHints(parameters: unknown): ToolArgumentHints {
  const properties = (parameters as { properties?: Record<string, unknown> })?.properties;
  if (!properties || typeof properties !== "object") return {};

  const names = Object.keys(properties);
  const stringNames = names.filter((n) => isStringType(properties[n]));
  if (stringNames.length === 0) return {};

  // Unambiguous when there's exactly one string field; otherwise require a
  // recognizable payload name so we don't slice the wrong one.
  const payloadKey = stringNames.length === 1 ? stringNames[0] : stringNames.find((n) => PAYLOAD_NAME.test(n));
  if (!payloadKey) return {};

  return { payloadKey, otherKeys: names.filter((n) => n !== payloadKey) };
}

/**
 * Decode a JSON string body leniently. Standard escapes (`\n \t \r \" \\ \/ \b
 * \f \uXXXX`) are interpreted; any other backslash sequence (`\d`, `\w`, `\U`,
 * …) is kept verbatim so regexes and paths survive. Only used on the recovery
 * path — well-formed arguments are parsed strictly and never reach this.
 */
function lenientUnescape(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\" || i + 1 >= raw.length) {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    switch (next) {
      case '"':
        out += '"';
        i++;
        break;
      case "\\":
        out += "\\";
        i++;
        break;
      case "/":
        out += "/";
        i++;
        break;
      case "n":
        out += "\n";
        i++;
        break;
      case "t":
        out += "\t";
        i++;
        break;
      case "r":
        out += "\r";
        i++;
        break;
      case "b":
        out += "\b";
        i++;
        break;
      case "f":
        out += "\f";
        i++;
        break;
      case "u": {
        const hex = raw.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
        } else {
          out += ch; // invalid \u — keep the backslash literally
        }
        break;
      }
      default:
        out += ch; // unknown escape (\d, \w, \U, …) — keep the backslash literally
    }
  }
  return out;
}

/** Index of the last match of a global regex, or -1. */
function lastIndexOfPattern(text: string, re: RegExp): number {
  let idx = -1;
  for (const m of text.matchAll(re)) idx = m.index;
  return idx;
}

/**
 * Recover the value of a single dominant string field from arguments that
 * `JSON.parse` rejected. Models routinely leave inner quotes, newlines, tabs,
 * and backslashes unescaped when packing source into `code`/`command`. Rather
 * than guess like `jsonrepair` — which can silently truncate the payload and
 * invent keys — this anchors on the field's structural boundaries: the value
 * runs from its opening quote to the last `,"<otherKey>":` separator (or the
 * closing brace), then is leniently un-escaped.
 */
function recoverDominantStringField(
  text: string,
  payloadKey: string,
  otherKeys: string[],
): Record<string, unknown> | null {
  const open = new RegExp(`"${payloadKey}"\\s*:\\s*"`).exec(text);
  if (!open) return null;
  const start = open.index + open[0].length;

  // Value ends at the earliest of: the final closing brace, or the *last*
  // `,"<otherKey>":` separator (trailing fields come after the payload, so the
  // last occurrence is the real separator — an inner one inside code won't win).
  let boundary = text.lastIndexOf("}");
  if (boundary < start) boundary = text.length;
  for (const key of otherKeys) {
    const rel = lastIndexOfPattern(text.slice(start), new RegExp(`,\\s*"${key}"\\s*:`, "g"));
    if (rel >= 0) boundary = Math.min(boundary, start + rel);
  }

  // Trim trailing whitespace, then the single closing quote of the value.
  let end = boundary;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (text[end - 1] === '"') end--;

  const result: Record<string, unknown> = { [payloadKey]: lenientUnescape(text.slice(start, end)) };

  // Best-effort scalars for the remaining fields (null when absent or unparseable).
  for (const key of otherKeys) {
    const m = new RegExp(`"${key}"\\s*:\\s*(null|true|false|"[^"]*"|\\[[^\\]]*\\]|-?\\d+(?:\\.\\d+)?)`).exec(text);
    if (m) {
      try {
        result[key] = JSON.parse(m[1]);
      } catch {
        result[key] = null;
      }
    } else {
      result[key] = null;
    }
  }
  return result;
}

/**
 * Parse LLM tool-call arguments. Models frequently mis-escape quotes, newlines,
 * tabs, and backslashes when packing source code into a JSON string field,
 * producing arguments that `JSON.parse` rejects (e.g. `{"code":"print("hi")"}`).
 *
 * Order of attempts:
 *  1. Strict `JSON.parse` — well-formed args always win and are never touched.
 *  2. Schema-aware recovery of the dominant string field (when `hints.payloadKey`
 *     is known) — precise and boundary-anchored.
 *  3. `jsonrepair` — generic last resort for tools without a payload field.
 *
 * Recovery runs *before* `jsonrepair` because `jsonrepair` can silently truncate
 * a code payload (e.g. `python3 -c "print('hi')"` → `python3 -c `); for the code
 * tools we'd rather reconstruct the field than execute a corrupted command.
 *
 * @throws {ToolArgumentsParseError} when nothing recovers the string.
 */
export function parseToolArguments(raw: string | undefined | null, hints?: ToolArgumentHints): Record<string, unknown> {
  const text = (raw ?? "").trim();
  if (!text) return {};

  try {
    return asObject(JSON.parse(text));
  } catch {
    // Fall through to recovery.
  }

  if (hints?.payloadKey) {
    const recovered = recoverDominantStringField(text, hints.payloadKey, hints.otherKeys ?? []);
    if (recovered) return recovered;
  }

  try {
    return asObject(JSON.parse(jsonrepair(text)));
  } catch (reason) {
    throw new ToolArgumentsParseError(text, reason);
  }
}

/**
 * Lenient variant for UI/render paths that should never throw — returns `null`
 * instead of raising. Use this when parsing partial (mid-stream) arguments or
 * when a parse failure should just hide a preview rather than surface an error.
 */
export function tryParseToolArguments(
  raw: string | undefined | null,
  hints?: ToolArgumentHints,
): Record<string, unknown> | null {
  try {
    return parseToolArguments(raw, hints);
  } catch {
    return null;
  }
}
