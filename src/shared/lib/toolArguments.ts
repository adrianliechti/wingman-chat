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
  declaredKeys?: string[];
}

// String fields whose name implies a code/command/text payload. When a tool has
// several string properties we only enable recovery if one of them matches —
// otherwise we can't tell which holds the blob and leave it to jsonrepair.
const PAYLOAD_NAME = /^(code|command|script|source|sql|query|content|body|text|input|instructions|prompt|patch|diff)$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> {
  // Tool arguments are always a JSON object. A bare array/number/string means
  // the model emitted something malformed enough that repair "succeeded" on the
  // wrong shape — treat that as a non-object and let callers see empty args.
  return isPlainObject(value) ? value : {};
}

function isStringType(schema: unknown): boolean {
  const typed = schema as { type?: unknown; anyOf?: unknown; oneOf?: unknown };
  const type = typed?.type;
  const alternatives = Array.isArray(typed?.anyOf) ? typed.anyOf : Array.isArray(typed?.oneOf) ? typed.oneOf : [];
  return type === "string" || (Array.isArray(type) && type.includes("string")) || alternatives.some(isStringType);
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
  if (names.length === 0) return {};
  const stringNames = names.filter((n) => isStringType(properties[n]));

  // Only recover fields whose name identifies them as a free-text payload.
  // A lone top-level string is not necessarily the payload: edit, for
  // example, has a string `path` plus quote-heavy strings nested in `edits`.
  // Treating `path` as dominant would discard the edits on malformed input.
  const payloadKey = stringNames.find((n) => PAYLOAD_NAME.test(n));
  if (!payloadKey) return { declaredKeys: names };

  return { payloadKey, otherKeys: names.filter((n) => n !== payloadKey), declaredKeys: names };
}

/**
 * Decode a JSON string body leniently. Standard escapes (`\n \t \r \" \\ \/ \b
 * \f \uXXXX`) are interpreted; any other backslash sequence (`\d`, `\w`, `\U`,
 * …) is kept verbatim so regexes and paths survive. Only used on the recovery
 * path — well-formed arguments are parsed strictly and never reach this.
 */
function lenientUnescape(raw: string, quote: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\" || i + 1 >= raw.length) {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === quote || (quote === "\u201c" && next === "\u201d") || (quote === "\u2018" && next === "\u2019")) {
      out += next;
      i++;
      continue;
    }
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

/** True when `slice` contains one of `chars` not preceded by an odd number of backslashes. */
function hasUnescapedChar(slice: string, chars: readonly string[]): boolean {
  let backslashes = 0;
  for (const ch of slice) {
    if (ch === "\\") {
      backslashes++;
      continue;
    }
    if (chars.includes(ch) && backslashes % 2 === 0) return true;
    backslashes = 0;
  }
  return false;
}

/** True when the slice contains an escaped-backslash pair (`\\`), read left to right. */
function hasEscapedBackslashPair(slice: string): boolean {
  for (let i = 0; i < slice.length - 1; i++) {
    if (slice[i] !== "\\") continue;
    if (slice[i + 1] === "\\") return true;
    i++; // lone escape unit — skip its target
  }
  return false;
}

/**
 * Decode `\<quote>` and `\\` sequences, leaving every other backslash sequence
 * untouched. Used when line breaks arrived raw: the remaining `\n`/`\t` in the
 * payload are then literal source text (a Python "\n"), not escaped whitespace,
 * while `\"` and `\\` still show deliberate escaping that must be reversed.
 */
function unescapeQuotesAndBackslashes(slice: string, quoteChars: readonly string[]): string {
  let out = "";
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === "\\" && i + 1 < slice.length && (slice[i + 1] === "\\" || quoteChars.includes(slice[i + 1]))) {
      out += slice[i + 1];
      i++;
    } else {
      out += slice[i];
    }
  }
  return out;
}

/** Decode `\uXXXX` sequences only, keeping every other backslash pair verbatim. */
function unescapeUnicodeOnly(segment: string): string {
  let out = "";
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    const hex = ch === "\\" && segment[i + 1] === "u" ? segment.slice(i + 2, i + 6) : "";
    if (/^[0-9a-fA-F]{4}$/.test(hex)) {
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else if (ch === "\\" && i + 1 < segment.length) {
      out += ch + segment[i + 1];
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Positionally decode a payload whose delimiter quotes arrived raw. Escape
 * sequences OUTSIDE the payload's own string literals are structural (`\n`
 * between statements of a flattened file) and decode leniently — lenient keeps
 * non-JSON sequences like `C:\build` intact. INSIDE a raw-quoted literal they
 * are source text (`"C:\new\temp.txt"`, `re.compile("\d+")`, `EOL = "\n"`) and
 * stay verbatim except `\uXXXX` — unless an escaped-backslash pair anywhere in
 * the slice proves the model was escaping backslashes too, in which case the
 * literals are JSON-encoded and decode fully (`r"\\d{4}"` → `r"\d{4}"`).
 * Apostrophes are not treated as literal delimiters (prose like "don't" in a
 * comment would open a phantom string) unless they delimit the payload itself.
 */
function decodeAroundRawStrings(slice: string, quote: string): string {
  const toggles = new Set(['"', "`", quote]);
  const literalsAreEncoded = hasEscapedBackslashPair(slice);
  let out = "";
  let segmentStart = 0;
  let stringChar: string | null = null;
  const flush = (end: number, inString: boolean) => {
    const segment = slice.slice(segmentStart, end);
    out += inString && !literalsAreEncoded ? unescapeUnicodeOnly(segment) : lenientUnescape(segment, quote);
    segmentStart = end;
  };
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    if (ch === "\\") {
      i++;
    } else if (stringChar) {
      if (ch === stringChar) {
        flush(i + 1, true);
        stringChar = null;
      }
    } else if (toggles.has(ch)) {
      flush(i, false);
      stringChar = ch;
    }
  }
  flush(slice.length, stringChar !== null);
  return out;
}

/**
 * Decode a recovered payload slice by first judging how much the model actually
 * escaped. Raw (unescaped) delimiter quotes plus raw newlines mean the code was
 * dumped fully verbatim — decoding `\n` there would corrupt regexes and Windows
 * paths into control characters. Raw quotes alone mean string literals arrived
 * as source text: decode positionally around them. Raw newlines alone mean
 * whitespace was never escaped, so `\n`/`\t` stay literal and only
 * quote/backslash escapes are decoded. Otherwise fall through to the full
 * lenient decode.
 */
function decodePayloadSlice(slice: string, quote: string, closingQuote: string): string {
  const quoteChars = quote === closingQuote ? [quote] : [quote, closingQuote];
  const rawQuote = hasUnescapedChar(slice, quoteChars);
  const rawNewline = slice.includes("\n");
  if (rawQuote && rawNewline) return slice;
  if (rawQuote) return decodeAroundRawStrings(slice, quote);
  if (rawNewline) return unescapeQuotesAndBackslashes(slice, quoteChars);
  return lenientUnescape(slice, quote);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match JSON, JavaScript/Python, and typographic spellings of a property key. */
function propertyKeyPattern(key: string): string {
  const escaped = escapeRegExp(key);
  return `(?:"${escaped}"|'${escaped}'|\`${escaped}\`|\u201c${escaped}\u201d|\u2018${escaped}\u2019|${escaped})`;
}

function parseObjectFragment(fragment: string, declaredKeys: readonly string[]): Record<string, unknown> | null {
  let normalized = fragment;
  for (const key of declaredKeys) {
    const canonical = JSON.stringify(key);
    normalized = normalized.replace(
      new RegExp(
        `(?:'${escapeRegExp(key)}'|\`${escapeRegExp(key)}\`|\u201c${escapeRegExp(key)}\u201d|\u2018${escapeRegExp(key)}\u2019|${escapeRegExp(key)})\\s*:`,
        "g",
      ),
      `${canonical}:`,
    );
  }
  // Smart quotes are sometimes applied to the whole function call by a rich
  // text boundary. At this point the fragment contains sibling arguments only,
  // so converting paired smart strings cannot alter the recovered payload.
  normalized = normalized
    .replace(/\u201c([^\u201d]*)\u201d/g, (_match, value: string) => JSON.stringify(value))
    .replace(/\u2018([^\u2019]*)\u2019/g, (_match, value: string) => JSON.stringify(value));

  try {
    return asObject(JSON.parse(normalized));
  } catch {
    try {
      return asObject(JSON.parse(jsonrepair(normalized)));
    } catch {
      return null;
    }
  }
}

function parseLeadingSiblings(
  text: string,
  propertyStart: number,
  declaredKeys: readonly string[],
): Record<string, unknown> | null {
  const objectStart = text.indexOf("{");
  if (objectStart < 0 || objectStart >= propertyStart) return {};
  const body = text
    .slice(objectStart + 1, propertyStart)
    .trim()
    .replace(/,$/, "");
  return body ? parseObjectFragment(`{${body}}`, declaredKeys) : {};
}

function parseTrailingSiblings(
  text: string,
  separator: number,
  declaredKeys: readonly string[],
): Record<string, unknown> | null {
  const outerEnd = text.lastIndexOf("}");
  let body = text.slice(separator + 1, outerEnd > separator ? outerEnd : text.length).trim();
  body = body.replace(/```(?:json)?\s*$/i, "").trim();
  return body ? parseObjectFragment(`{${body}}`, declaredKeys) : {};
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
  const open = new RegExp(`(?:^|[,{])\\s*${propertyKeyPattern(payloadKey)}\\s*:\\s*(["'\u201c\u2018\x60])`).exec(text);
  if (!open) return null;
  const start = open.index + open[0].length;
  const quote = open[1];
  const closingQuote = quote === "\u201c" ? "\u201d" : quote === "\u2018" ? "\u2019" : quote;

  // Parse the structurally complete part before the payload. Besides recovering
  // leading values, this is more precise than merely looking for key-shaped text
  // that may itself occur inside a path or another string.
  const leading = parseLeadingSiblings(text, open.index, otherKeys);
  if (!leading) return null;
  const leadingKeys = new Set(Object.keys(leading).filter((key) => otherKeys.includes(key)));

  // A key-looking sequence inside source code is only accepted as an outer
  // boundary when everything after it parses as a sibling-object fragment.
  // This prevents `const x = {"method":"GET","path":"/api"}` from truncating
  // `code` when the actual outer `path` argument was omitted.
  const possibleOuterEnd = text.lastIndexOf("}");
  const afterOuterEnd =
    possibleOuterEnd >= 0
      ? text
          .slice(possibleOuterEnd + 1)
          .replace(/```(?:json)?/gi, "")
          .trim()
      : "";
  // Accept the outer `}` as the value's end when the text before it is the
  // closing quote, optionally followed by a trailing comma (`"...",}`).
  let boundary = text.length;
  if (possibleOuterEnd >= start && afterOuterEnd === "") {
    let cut = possibleOuterEnd;
    while (cut > start && /\s/.test(text[cut - 1])) cut--;
    if (text[cut - 1] === ",") {
      cut--;
      while (cut > start && /\s/.test(text[cut - 1])) cut--;
    }
    if (cut > start && text[cut - 1] === closingQuote) boundary = cut;
  }
  let trailing: Record<string, unknown> = {};
  for (const key of otherKeys) {
    if (leadingKeys.has(key)) continue;
    const separator = new RegExp(`,\\s*${propertyKeyPattern(key)}\\s*:`, "g");
    const candidates = [...text.slice(start).matchAll(separator)].map((match) => start + match.index).reverse();
    for (const candidate of candidates) {
      const parsed = parseTrailingSiblings(text, candidate, otherKeys);
      if (
        parsed &&
        Object.prototype.hasOwnProperty.call(parsed, key) &&
        Object.keys(parsed).every((parsedKey) => otherKeys.includes(parsedKey))
      ) {
        if (candidate < boundary) {
          boundary = candidate;
          trailing = parsed;
        }
        break;
      }
    }
  }

  // Trim trailing whitespace, then the single closing quote of the value.
  let end = boundary;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (text[end - 1] === closingQuote) end--;

  const result: Record<string, unknown> = {
    ...leading,
    ...trailing,
    [payloadKey]: decodePayloadSlice(text.slice(start, end), quote, closingQuote),
  };

  return result;
}

// Wrapper keys some providers/models nest the real arguments under
// (e.g. `{"arguments": {"path": …, "content": …}}`).
const WRAPPER_KEYS = ["arguments", "args", "input", "parameters", "params", "tool_input", "toolInput", "properties"];

/**
 * Unwrap `{"arguments": {...}}`-style nesting, but only when the tool schema is
 * known and rules out the wrapper being a legitimate argument: the wrapper key
 * must not be declared, and the inner object must carry at least one declared key.
 */
function unwrapKnownWrapper(args: Record<string, unknown>, hints?: ToolArgumentHints): Record<string, unknown> {
  const declared = hints?.declaredKeys;
  if (!declared?.length) return args;
  const keys = Object.keys(args);
  if (keys.length !== 1) return args;
  const [key] = keys;
  if (declared.includes(key) || !WRAPPER_KEYS.includes(key)) return args;
  const inner = args[key];
  if (!isPlainObject(inner)) return args;
  const innerKeys = Object.keys(inner);
  if (innerKeys.length > 0 && !innerKeys.some((k) => declared.includes(k))) return args;
  return inner;
}

const PROVIDER_PARAMETER_BOUNDARY = /<\/?antml_parameter\s*>|<\/?parameter(?:\s+name=(?:"[^"]+"|'[^']+'))?\s*>/i;
const PROVIDER_PARAMETER_OPEN = /<parameter\s+name=(?:"([^"]+)"|'([^']+)')\s*>/gi;

function parseLeakedParameterValue(raw: string): unknown {
  const value = raw.trim();
  if (!value) return "";
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Recover a Bedrock/Anthropic translation failure observed in real Responses
 * traffic where internal AntML parameter boundaries leak into an otherwise
 * valid JSON string, for example:
 *
 *   path: "</antml_parameter>\n<parameter name=\"skills\">[]"
 *
 * Only declared, non-payload string fields are touched. Large `code`/`content`
 * values remain byte-for-byte unchanged even if they intentionally contain
 * similar markup. Embedded declared parameters fill missing values but never
 * replace a clean value that was already parsed.
 */
function recoverLeakedProviderParameters(
  args: Record<string, unknown>,
  hints?: ToolArgumentHints,
): Record<string, unknown> {
  const declared = hints?.declaredKeys;
  if (!declared?.length) return args;

  let recovered: Record<string, unknown> | undefined;
  for (const key of declared) {
    if (key === hints?.payloadKey) continue;
    const value = args[key];
    if (typeof value !== "string") continue;
    const firstBoundary = value.search(PROVIDER_PARAMETER_BOUNDARY);
    if (firstBoundary < 0) continue;

    recovered ??= { ...args };
    recovered[key] = value.slice(0, firstBoundary).trimEnd();

    PROVIDER_PARAMETER_OPEN.lastIndex = 0;
    for (let match = PROVIDER_PARAMETER_OPEN.exec(value); match; match = PROVIDER_PARAMETER_OPEN.exec(value)) {
      const embeddedKey = match[1] ?? match[2];
      if (!declared.includes(embeddedKey) || embeddedKey === hints?.payloadKey) continue;
      const bodyStart = match.index + match[0].length;
      const nextBoundary = value.slice(bodyStart).search(PROVIDER_PARAMETER_BOUNDARY);
      const bodyEnd = nextBoundary < 0 ? value.length : bodyStart + nextBoundary;
      const existing = recovered[embeddedKey];
      if (existing === undefined || (typeof existing === "string" && PROVIDER_PARAMETER_BOUNDARY.test(existing))) {
        recovered[embeddedKey] = parseLeakedParameterValue(value.slice(bodyStart, bodyEnd));
      }
    }
  }
  return recovered ?? args;
}

/**
 * Coerce a successfully parsed value into an arguments object:
 * - a string is a double-encoded arguments payload — parse it again (bounded);
 * - a one-element array is an accidental wrapping of the arguments object;
 * - known wrapper keys (`arguments`, `input`, …) are peeled off.
 * Returns undefined when the value cannot be shaped into an object, so callers
 * can fall through to recovery/repair instead of silently yielding `{}`.
 */
function normalizeParsed(
  parsed: unknown,
  hints: ToolArgumentHints | undefined,
  depth: number,
): Record<string, unknown> | undefined {
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed === "string") {
    const inner = parsed.trim();
    if (!inner) return {};
    if (depth <= 0) return undefined;
    try {
      return parseArgumentsText(inner, hints, depth - 1);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1 || !isPlainObject(parsed[0])) return undefined;
    return unwrapKnownWrapper(parsed[0], hints);
  }
  if (isPlainObject(parsed)) return unwrapKnownWrapper(parsed, hints);
  return undefined;
}

/**
 * Split text that is several complete JSON objects back to back — a streaming
 * accumulation glitch where a provider re-sends the full argument snapshot
 * instead of a delta (`{...}{...}`). Only succeeds when every segment parses
 * strictly, so malformed payload content can never be mistaken for segments.
 */
function splitConcatenatedObjects(text: string): Record<string, unknown>[] | null {
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  const objects: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth < 0) return null;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, i + 1));
          if (!isPlainObject(parsed)) return null;
          objects.push(parsed);
        } catch {
          return null;
        }
      }
    } else if (depth === 0 && !/\s/.test(ch)) {
      return null;
    }
  }
  if (depth !== 0 || inString) return null;
  return objects.length >= 2 ? objects : null;
}

/**
 * Parse LLM tool-call arguments. Models frequently mis-escape quotes, newlines,
 * tabs, and backslashes when packing source code into a JSON string field,
 * producing arguments that `JSON.parse` rejects (e.g. `{"code":"print("hi")"}`).
 *
 * Order of attempts:
 *  1. Strict `JSON.parse` — well-formed args always win. The parsed value is
 *     still normalized: double-encoded strings are parsed again, one-element
 *     arrays and `{"arguments": {...}}` wrappers are unwrapped.
 *  2. Concatenated complete objects (`{...}{...}` streaming snapshot glitch) —
 *     the last snapshot wins.
 *  3. Schema-aware recovery of the dominant string field (when `hints.payloadKey`
 *     is known) — precise and boundary-anchored.
 *  4. `jsonrepair` — generic last resort for tools without a payload field.
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
  return recoverLeakedProviderParameters(parseArgumentsText(text, hints, 2), hints);
}

function parseArgumentsText(
  text: string,
  hints: ToolArgumentHints | undefined,
  depth: number,
): Record<string, unknown> {
  let strictParsed: unknown;
  let strictOk = false;
  try {
    strictParsed = JSON.parse(text);
    strictOk = true;
  } catch {
    // Fall through to recovery.
  }
  if (strictOk) {
    const normalized = normalizeParsed(strictParsed, hints, depth);
    if (normalized) return normalized;
    // Valid JSON of the wrong shape (multiple objects in an array, a bare
    // number, an undecodable nested string). Recovery slices malformed text and
    // would corrupt valid JSON, so fail fast with an actionable error instead.
    throw new ToolArgumentsParseError(
      text,
      new Error(
        typeof strictParsed === "string"
          ? "Arguments were a JSON-encoded string whose contents could not be parsed as an object."
          : "Arguments parsed to a JSON value that is not a single object.",
      ),
    );
  }

  const snapshots = splitConcatenatedObjects(text);
  if (snapshots) return unwrapKnownWrapper(snapshots[snapshots.length - 1], hints);

  if (hints?.payloadKey) {
    const recovered = recoverDominantStringField(text, hints.payloadKey, hints.otherKeys ?? []);
    if (recovered) return recovered;
  }

  try {
    const normalized = normalizeParsed(JSON.parse(jsonrepair(text)), hints, depth);
    if (normalized) return normalized;
    throw new Error("Arguments did not repair to a JSON object.");
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
