import { describe, expect, it } from "vitest";
import { firstDay, lastDay, monthOf, monthWeeks, shiftMonth } from "./dates.js";

describe("month helpers", () => {
  it("moves months across years", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthOf("2026-09-27")).toBe("2026-09");
  });

  it("finds the first and last day, leap years included", () => {
    expect(firstDay("2026-09")).toBe("2026-09-01");
    expect(lastDay("2026-02")).toBe("2026-02-28");
    expect(lastDay("2028-02")).toBe("2028-02-29");
  });

  it("lists the Monday-to-Sunday weeks that touch a month", () => {
    const weeks = monthWeeks("2026-09");
    expect(weeks).toHaveLength(5);
    expect(weeks[0]?.[0]).toBe("2026-08-31");
    expect(weeks[4]?.[6]).toBe("2026-10-04");
    expect(monthWeeks("2026-02")[0]?.[0]).toBe("2026-01-26");
  });
});
