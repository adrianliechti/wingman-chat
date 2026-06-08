/**
 * Render simple `{{variable}}` placeholders in a template string.
 *
 * Built-in variables (case-insensitive, optional surrounding whitespace):
 *   {{date}}     — current date, locale-formatted (e.g. "6/9/2026")
 *   {{time}}     — current time, locale-formatted
 *   {{datetime}} — current date and time, locale-formatted
 *   {{iso}}      — current timestamp as full ISO 8601
 *   {{timezone}} — resolved IANA time zone (e.g. "Europe/Zurich")
 *   {{locale}}   — browser locale (e.g. "de-CH")
 *
 * Unknown placeholders are left untouched. Extra variables can be supplied
 * via `extra`, which takes precedence over the built-ins.
 */
export function renderTemplate(
  template: string,
  extra: Record<string, string> = {},
  now: Date = new Date(),
): string {
  const builtins: Record<string, () => string> = {
    date: () => now.toLocaleDateString(),
    time: () => now.toLocaleTimeString(),
    datetime: () => now.toLocaleString(),
    iso: () => now.toISOString(),
    timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: () => navigator.language,
  };

  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (key in extra) return extra[key];
    const fn = builtins[key];
    return fn ? fn() : match;
  });
}
