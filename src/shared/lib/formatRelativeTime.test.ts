import { describe, expect, it } from "vitest";
import { formatAbsoluteTime, formatRelativeTime } from "./formatRelativeTime";

const now = Date.UTC(2026, 8, 19, 12, 0, 0);

describe("formatRelativeTime", () => {
  it("collapses the first seconds into just now", () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe("just now");
  });

  it("uses minutes, hours and days within a week", () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(formatRelativeTime(now - 24 * 3_600_000, now)).toBe("yesterday");
    expect(formatRelativeTime(now - 3 * 24 * 3_600_000, now)).toBe("3 days ago");
  });

  it("falls back to an absolute date after a week", () => {
    expect(formatRelativeTime(new Date(now - 30 * 24 * 3_600_000).toISOString(), now)).toMatch(/2026/);
  });

  it("returns an empty string for unparseable input", () => {
    expect(formatRelativeTime("not a date", now)).toBe("");
    expect(formatAbsoluteTime("not a date")).toBe("");
  });
});
