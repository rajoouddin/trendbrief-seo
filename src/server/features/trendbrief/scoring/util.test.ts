import { describe, expect, it } from "vitest";
import { daysBetween, roundComponent } from "./util";

describe("roundComponent", () => {
  it("rounds a 0-1 value to 4 decimal places", () => {
    expect(roundComponent(0.123456)).toBe(0.1235);
  });
});

describe("daysBetween", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");

  it("returns whole, floor-rounded days between an ISO date and now", () => {
    expect(daysBetween("2026-08-01", now)).toBe(31);
  });

  it("never returns a negative number for a date in the future", () => {
    expect(daysBetween("2026-09-15", now)).toBe(0);
  });

  it("throws a clear error instead of silently returning NaN for an unparseable date", () => {
    expect(() => daysBetween("not-a-date", now)).toThrow(/unparseable date/);
  });
});
