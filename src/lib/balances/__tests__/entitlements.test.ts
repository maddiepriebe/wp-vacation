import { describe, expect, it } from "vitest";
import {
  computePersonalEntitlement,
  computeVacationEntitlement,
} from "@/lib/balances/entitlements";

// All inputs as YYYY-MM-DD strings. All return values are hours.
// avg_daily_hours = scheduled_hours_per_week / 5; default 8 (40 hrs/wk).

describe("computeVacationEntitlement", () => {
  it("returns 0 under 6 months", () => {
    // hired 2025-12-15, asOf 2026-03-01 → ~2.5 months
    expect(computeVacationEntitlement("2025-12-15", "2026-03-01", 40)).toBe(0);
  });

  it("returns 0 the day before 6 months", () => {
    // hired 2025-11-15, asOf 2026-05-14 → 5 months 30 days (1 day short)
    expect(computeVacationEntitlement("2025-11-15", "2026-05-14", 40)).toBe(0);
  });

  it("returns 5 days at exactly 6 months", () => {
    // hired 2025-11-15, asOf 2026-05-15 → exactly 6 months
    // 5 days × 8 hrs = 40 hrs
    expect(computeVacationEntitlement("2025-11-15", "2026-05-15", 40)).toBe(40);
  });

  it("returns 5 days × 7 hrs/day for a 35-hr/week employee", () => {
    expect(computeVacationEntitlement("2025-11-15", "2026-05-15", 35)).toBe(35);
  });

  it("returns 10 days at 1 year", () => {
    expect(computeVacationEntitlement("2025-05-15", "2026-05-15", 40)).toBe(80);
  });

  it("returns 10 days during the 1–3 year tier", () => {
    expect(computeVacationEntitlement("2024-05-15", "2026-05-15", 40)).toBe(80);
  });

  it("returns 15 days at 4 completed years", () => {
    expect(computeVacationEntitlement("2022-05-15", "2026-05-15", 40)).toBe(120);
  });

  it("returns 15 days during the 4–5 year tier", () => {
    expect(computeVacationEntitlement("2021-05-15", "2026-05-15", 40)).toBe(120);
  });

  it("returns 20 days at 6+ years", () => {
    expect(computeVacationEntitlement("2020-05-15", "2026-05-15", 40)).toBe(160);
  });

  it("returns 20 days far into 6+ tier", () => {
    expect(computeVacationEntitlement("2010-05-15", "2026-05-15", 40)).toBe(160);
  });
});

describe("computePersonalEntitlement", () => {
  it("returns 0 under 90 days", () => {
    // hired 2026-03-01, asOf 2026-05-14 → ~74 days
    expect(computePersonalEntitlement("2026-03-01", "2026-05-14", 40)).toBe(0);
  });

  it("returns 4 days at exactly 90 days", () => {
    // hired 2026-02-13, asOf 2026-05-14 → 90 days
    // 4 × 8 = 32 hrs
    expect(computePersonalEntitlement("2026-02-13", "2026-05-14", 40)).toBe(32);
  });

  it("returns 4 days during the 90-day → 6-month window", () => {
    // hired 2025-12-15, asOf 2026-03-15 → 90 days
    expect(computePersonalEntitlement("2025-12-15", "2026-03-15", 40)).toBe(32);
  });

  it("returns 9 days at 6 months", () => {
    expect(computePersonalEntitlement("2025-11-15", "2026-05-15", 40)).toBe(72);
  });

  it("returns 9 days regardless of tenure past 6 months (no growth)", () => {
    expect(computePersonalEntitlement("2015-05-15", "2026-05-15", 40)).toBe(72);
  });

  it("scales by scheduled_hours_per_week", () => {
    expect(computePersonalEntitlement("2025-11-15", "2026-05-15", 35)).toBe(63);
  });
});
