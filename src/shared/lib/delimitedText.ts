/** Hard model limits shared in spirit with the XLSX worksheet preview. */
export const DEFAULT_DELIMITED_TEXT_LIMITS = Object.freeze({
  maxSourceCharacters: 64 * 1024 * 1024,
  maxRows: 100_000,
  maxColumns: 16_384,
  maxCells: 250_000,
  maxRetainedCharacters: 64 * 1024 * 1024,
});

export interface DelimitedTextLimits {
  maxSourceCharacters: number;
  maxRows: number;
  maxColumns: number;
  maxCells: number;
  maxRetainedCharacters: number;
}

export interface ParseDelimitedTextOptions {
  /** One literal separator. Omit to detect comma, semicolon, or tab. */
  delimiter?: string;
  /** Internal resource-policy overrides, also useful for boundary tests. */
  limits?: Partial<DelimitedTextLimits>;
}

export class DelimitedTextResourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DelimitedTextResourceLimitError";
  }
}

function resolveLimits(overrides: Partial<DelimitedTextLimits> | undefined): DelimitedTextLimits {
  const limits = { ...DEFAULT_DELIMITED_TEXT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative safe integer`);
    }
  }
  return limits;
}

function assertDelimiter(delimiter: string): void {
  if (delimiter.length !== 1) throw new TypeError("delimiter must be exactly one character");
  if (delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
    throw new TypeError("delimiter cannot be a quote or record separator");
  }
}

/** Detect a separator from the first logical record, respecting quoted breaks. */
export function detectDelimitedTextDelimiter(source: string): string {
  const counts = new Map<string, number>([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  let atFieldStart = true;
  let afterQuote = false;

  const start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') index++;
        else {
          quoted = false;
          afterQuote = true;
        }
      }
      continue;
    }

    if (character === "\r" || character === "\n") break;
    if (!afterQuote && character === '"' && atFieldStart) {
      quoted = true;
      continue;
    }
    if (counts.has(character)) {
      counts.set(character, (counts.get(character) ?? 0) + 1);
      atFieldStart = true;
      afterQuote = false;
    } else {
      atFieldStart = false;
    }
  }

  const commas = counts.get(",") ?? 0;
  const semicolons = counts.get(";") ?? 0;
  const tabs = counts.get("\t") ?? 0;
  if (tabs > 0 && tabs >= commas && tabs >= semicolons) return "\t";
  if (semicolons > commas) return ";";
  return ",";
}

/**
 * Parse CSV/TSV-style records in one pass. Quoted record breaks are normalized
 * to LF, all values remain strings, and malformed quoting fails explicitly.
 */
export function parseDelimitedText(source: string, options: ParseDelimitedTextOptions = {}): string[][] {
  const limits = resolveLimits(options.limits);
  if (source.length > limits.maxSourceCharacters) {
    throw new DelimitedTextResourceLimitError(
      `Delimited text exceeds the ${limits.maxSourceCharacters}-character source limit`,
    );
  }

  const delimiter = options.delimiter ?? detectDelimitedTextDelimiter(source);
  assertDelimiter(delimiter);
  const startIndex = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (source.length === startIndex) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let fieldChunks: string[] | undefined;
  let logicalCellCount = 0;
  let retainedCharacters = 0;
  let quoted = false;
  let afterQuote = false;

  const appendField = (value: string): void => {
    field += value;
    // Avoid quadratic concatenation for one pathological field without keeping
    // one allocation per source character.
    if (field.length >= 4096) {
      (fieldChunks ??= []).push(field);
      field = "";
    }
  };

  const finishField = (): void => {
    logicalCellCount++;
    if (logicalCellCount > limits.maxCells) {
      throw new DelimitedTextResourceLimitError(`Delimited text exceeds the ${limits.maxCells}-cell limit`);
    }
    if (row.length >= limits.maxColumns) {
      throw new DelimitedTextResourceLimitError(
        `Delimited text row ${rows.length + 1} exceeds the ${limits.maxColumns}-column limit`,
      );
    }

    const value = fieldChunks ? fieldChunks.join("") + field : field;
    retainedCharacters += value.length;
    if (retainedCharacters > limits.maxRetainedCharacters) {
      throw new DelimitedTextResourceLimitError(
        `Delimited text exceeds the ${limits.maxRetainedCharacters}-character retained-text limit`,
      );
    }
    row.push(value);
    field = "";
    fieldChunks = undefined;
    afterQuote = false;
  };

  const finishRow = (): void => {
    if (rows.length >= limits.maxRows) {
      throw new DelimitedTextResourceLimitError(`Delimited text exceeds the ${limits.maxRows}-row limit`);
    }
    rows.push(row);
    row = [];
  };

  for (let index = startIndex; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character !== '"') {
        if (character === "\r") {
          appendField("\n");
          if (source[index + 1] === "\n") index++;
        } else {
          appendField(character);
        }
        continue;
      }
      if (source[index + 1] === '"') {
        appendField('"');
        index++;
      } else {
        quoted = false;
        afterQuote = true;
      }
      continue;
    }

    if (afterQuote) {
      if (character !== delimiter && character !== "\r" && character !== "\n") {
        throw new SyntaxError(
          `Unexpected character after closing quote at row ${rows.length + 1}, column ${row.length + 1}`,
        );
      }
    } else if (character === '"' && field === "" && fieldChunks === undefined) {
      quoted = true;
      continue;
    }

    if (character === delimiter) {
      finishField();
      continue;
    }
    if (character === "\r" || character === "\n") {
      finishField();
      finishRow();
      if (character === "\r" && source[index + 1] === "\n") index++;
      continue;
    }
    appendField(character);
  }

  if (quoted) {
    throw new SyntaxError(`Unterminated quoted field at row ${rows.length + 1}, column ${row.length + 1}`);
  }
  if (!source.endsWith("\n") && !source.endsWith("\r")) {
    finishField();
    finishRow();
  }
  return rows;
}
