import { describe, expect, it } from "vitest";
import { createDataCellFormatter, isTemporalDataType } from "./dataCell";

describe("data preview cells", () => {
  it("uses readable, locale-aware dates without adding a time", () => {
    expect(createDataCellFormatter("DATE", "en-US")("2026-01-02")).toBe("Jan 2, 2026");
    expect(createDataCellFormatter("DATE", "de-CH")("2026-01-02")).toBe("2. Jan. 2026");
  });

  it("preserves wall-clock times and fractional precision", () => {
    const format = createDataCellFormatter("TIMESTAMP_NS", "en-US");
    expect(format("2026-01-02 00:30:45.123456789")).toBe("Jan 2, 2026, 00:30:45.123456789");
    expect(format("2026-01-02 00:00:00")).toBe("Jan 2, 2026, 00:00:00");
    expect(format("2026-01-02T00:00:00.000Z")).toBe("Jan 2, 2026, 00:00:00 UTC");
    expect(createDataCellFormatter("TIME")("14:30:45.123456")).toBe("14:30:45.123456");
  });

  it("keeps explicit time zones visible without shifting the date", () => {
    const format = createDataCellFormatter("TIMESTAMP WITH TIME ZONE", "en-US");
    expect(format("2026-01-02 00:30:00+00")).toBe("Jan 2, 2026, 00:30:00 UTC");
    expect(format("2026-01-02 00:30:00+05:30")).toBe("Jan 2, 2026, 00:30:00 UTC+05:30");
  });

  it("keeps nulls empty and unsupported or special date values readable", () => {
    const format = createDataCellFormatter("DATE", "en-US");
    expect(format(null)).toBe("");
    expect(format(undefined)).toBe("");
    for (const value of ["", "infinity", "-infinity", "2026-02-30", "2026-13-01", "10000-01-01", "not a date"]) {
      expect(format(value)).toBe(value);
    }
  });

  it("does not interpret text, numbers, or nested columns as dates", () => {
    expect(createDataCellFormatter("VARCHAR")("2026-01-02T00:00:00.000Z")).toBe("2026-01-02T00:00:00.000Z");
    expect(createDataCellFormatter("BIGINT")(42n)).toBe("42");
    expect(createDataCellFormatter("BOOLEAN")(false)).toBe("false");
    expect(createDataCellFormatter("STRUCT")({ day: "2026-01-02" })).toBe('{"day":"2026-01-02"}');
    expect(isTemporalDataType("DATE[]")).toBe(false);
    expect(isTemporalDataType("TIMESTAMP[2]")).toBe(false);
  });
});
