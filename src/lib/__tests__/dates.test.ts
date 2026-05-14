import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  assertTimeRange,
  isISODateString,
  isMondayISODate,
  timeToMinutes,
  todayET,
  weekEnd,
  weekStartOf,
} from "@/lib/dates";

describe("isISODateString", () => {
  it("accepts real YYYY-MM-DD", () => {
    expect(isISODateString("2026-05-14")).toBe(true);
  });
  it("rejects wrong format", () => {
    expect(isISODateString("2026/05/14")).toBe(false);
    expect(isISODateString("14-05-2026")).toBe(false);
    expect(isISODateString("2026-5-14")).toBe(false);
  });
  it("rejects non-real dates", () => {
    expect(isISODateString("2026-02-30")).toBe(false);
    expect(isISODateString("2026-13-01")).toBe(false);
  });
});

describe("isMondayISODate", () => {
  it("accepts a Monday in ET", () => {
    expect(isMondayISODate("2026-05-18")).toBe(true); // Monday
  });
  it("rejects non-Mondays", () => {
    expect(isMondayISODate("2026-05-14")).toBe(false); // Thursday
    expect(isMondayISODate("2026-05-17")).toBe(false); // Sunday
  });
  it("rejects invalid date strings", () => {
    expect(isMondayISODate("not-a-date")).toBe(false);
  });
});

describe("timeToMinutes", () => {
  it("returns minutes since midnight for 15-min granular times", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("08:15")).toBe(8 * 60 + 15);
    expect(timeToMinutes("23:45")).toBe(23 * 60 + 45);
  });
  it("returns NaN for non-15-min granular", () => {
    expect(Number.isNaN(timeToMinutes("08:07"))).toBe(true);
    expect(Number.isNaN(timeToMinutes("08:60"))).toBe(true);
  });
  it("returns NaN for malformed strings", () => {
    expect(Number.isNaN(timeToMinutes("8:00"))).toBe(true);
    expect(Number.isNaN(timeToMinutes("not a time"))).toBe(true);
  });
});

describe("assertTimeRange", () => {
  it("accepts start strictly less than end", () => {
    expect(() => assertTimeRange("08:00", "12:00")).not.toThrow();
  });
  it("throws on start equal to end", () => {
    expect(() => assertTimeRange("08:00", "08:00")).toThrow();
  });
  it("throws on start after end", () => {
    expect(() => assertTimeRange("12:00", "08:00")).toThrow();
  });
  it("throws on invalid times", () => {
    expect(() => assertTimeRange("invalid", "08:00")).toThrow();
  });
});

describe("weekStartOf", () => {
  it("returns the Monday of a Thursday's week (ET)", () => {
    expect(weekStartOf("2026-05-14")).toBe("2026-05-11"); // Thu → prior Mon
  });
  it("returns the same day for a Monday", () => {
    expect(weekStartOf("2026-05-11")).toBe("2026-05-11");
  });
});

describe("weekEnd", () => {
  it("returns Friday of the week given Monday", () => {
    expect(weekEnd("2026-05-11")).toBe("2026-05-15");
  });
});

describe("addDaysISO", () => {
  it("adds days to an ISO date", () => {
    expect(addDaysISO("2026-05-11", 4)).toBe("2026-05-15");
  });
  it("handles negative deltas", () => {
    expect(addDaysISO("2026-05-15", -4)).toBe("2026-05-11");
  });
  it("handles month boundaries", () => {
    expect(addDaysISO("2026-05-30", 5)).toBe("2026-06-04");
  });
});

describe("todayET", () => {
  it("returns a string in YYYY-MM-DD format", () => {
    expect(isISODateString(todayET())).toBe(true);
  });
});
