const temporalTypes = new Set([
  "DATE",
  "TIME",
  "TIME WITH TIME ZONE",
  "TIMETZ",
  "TIMESTAMP",
  "TIMESTAMP_S",
  "TIMESTAMP_MS",
  "TIMESTAMP_NS",
  "TIMESTAMP WITH TIME ZONE",
  "TIMESTAMPTZ",
]);

export const isTemporalDataType = (type = "") => temporalTypes.has(type.toUpperCase());

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

/** Temporal cells arrive as DuckDB text, preserving precision and wall-clock time. */
export function createDataCellFormatter(type: string, locale?: string): (value: unknown) => string {
  if (!isTemporalDataType(type)) return cellText;
  const dateFormat = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return (value) => {
    const text = cellText(value);
    // Format just the calendar date. Parsing the whole timestamp would shift
    // timezone-naive values, and JavaScript dates would truncate subseconds.
    const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-][\d:]+)?)?$/.exec(text);
    if (!match) return text;
    const [, day, time, offset] = match;
    const date = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return text;
    const formatted = dateFormat.format(date);
    if (!time) return formatted;
    const zone = !offset ? "" : /^(Z|[+-]00(?::?00){0,2})$/.test(offset) ? " UTC" : ` UTC${offset}`;
    return `${formatted}, ${time.replace(/\.0+$/, "")}${zone}`;
  };
}
