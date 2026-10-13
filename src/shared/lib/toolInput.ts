/**
 * A people-facing view of tool arguments. It reads only the JSON Schema and the
 * values, so it works the same for app tools and any MCP server.
 */

const acronyms: Record<string, string> = {
  api: "API",
  csv: "CSV",
  html: "HTML",
  id: "ID",
  ids: "IDs",
  ip: "IP",
  json: "JSON",
  pdf: "PDF",
  sql: "SQL",
  uri: "URI",
  url: "URL",
  urls: "URLs",
};

/** `max_chars` → "Max chars", `pageUrl` → "Page URL". */
export function inputLabel(key: string): string {
  const label = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .map((word) => acronyms[word.toLowerCase()] ?? word.toLowerCase())
    .join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Readable text for any JSON value; objects become "Label: value" lines. */
export function inputValue(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") {
    const media = /^data:([^;,]+)/.exec(value);
    return media ? `${media[1]} data` : value;
  }
  if (Array.isArray(value)) {
    if (!value.length) return "None";
    const flat = value.every((item) => item === null || typeof item !== "object");
    return value.map(inputValue).join(flat ? ", " : "\n\n");
  }
  if (typeof value === "object")
    return (
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => `${inputLabel(key)}: ${inputValue(item)}`)
        .join("\n") || "None"
    );
  return typeof value === "bigint" ? value.toLocaleString() : "";
}

export function isTextInput(value: unknown): value is string | string[] {
  return typeof value === "string"
    ? value.trim() !== ""
    : Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string");
}

/** Property names in declaration order, and every name any branch requires. */
function schemaKeys(schema: unknown, order: string[] = [], required = new Set<string>()) {
  if (!schema || typeof schema !== "object") return { order, required };
  const { properties, required: names, anyOf, oneOf, allOf } = schema as Record<string, unknown>;
  if (properties && typeof properties === "object") order.push(...Object.keys(properties));
  if (Array.isArray(names)) for (const name of names) if (typeof name === "string") required.add(name);
  for (const branches of [anyOf, oneOf, allOf])
    if (Array.isArray(branches)) for (const branch of branches) schemaKeys(branch, order, required);
  return { order, required };
}

/**
 * The arguments that carry the request itself (a URL, a query, instructions):
 * the required text arguments, else the first declared text argument. Everything
 * else is an option a person rarely needs to check before approving.
 */
export function primaryInputKeys(args: Record<string, unknown>, schema?: unknown): string[] {
  const { order, required } = schemaKeys(schema);
  const keys = [...new Set([...order, ...Object.keys(args)])].filter(
    (key) => Object.hasOwn(args, key) && isTextInput(args[key]),
  );
  const requested = keys.filter((key) => required.has(key));
  if (requested.length) return requested;
  const declared = keys.find((key) => order.includes(key));
  if (declared) return [declared];
  // Argument order is unreliable (restored interrupts may sort keys): a URL, else the longest text.
  const size = (key: string) => [args[key]].flat().join("").length;
  const url = keys.find((key) => typeof args[key] === "string" && /^https?:\/\//i.test(args[key].trim()));
  return url ? [url] : keys.sort((a, b) => size(b) - size(a)).slice(0, 1);
}
