const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/**
 * Short human wording for a past timestamp: "just now", "5 minutes ago",
 * "yesterday", then an absolute date once it is more than a week old.
 */
export function formatRelativeTime(value: string | number | Date, now: number = Date.now()): string {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const elapsed = now - time;
  if (elapsed < 45 * SECOND) return "just now";
  if (elapsed < HOUR) return relative.format(-Math.round(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return relative.format(-Math.round(elapsed / HOUR), "hour");
  if (elapsed < 7 * DAY) return relative.format(-Math.round(elapsed / DAY), "day");
  return new Date(time).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
}

/** Absolute timestamp for tooltips next to a relative label. */
export function formatAbsoluteTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
