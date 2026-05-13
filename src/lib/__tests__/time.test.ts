import { describe, it, expect } from "vitest";
import { APP_TIMEZONE, formatInAppTz } from "../time";

describe("time helpers", () => {
  it("uses America/New_York", () => {
    expect(APP_TIMEZONE).toBe("America/New_York");
  });

  it("formats a UTC instant in ET", () => {
    // 2026-05-13T16:00:00Z is 12:00 EDT (UTC-4)
    const result = formatInAppTz("2026-05-13T16:00:00Z", "HH:mm");
    expect(result).toBe("12:00");
  });
});
