import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type CalendarDay, PnlCalendar } from "./PnlCalendar.js";

const days = new Map<string, CalendarDay>([
  ["2026-09-01", { net: 410.1, trades: [1] }],
  ["2026-09-04", { net: 269.15, trades: [1, 2] }],
  ["2026-09-10", { net: 42, trades: [1, 2] }],
]);

describe("PnlCalendar", () => {
  it("shows each trading day's net and trade count, with a total per week", () => {
    render(<PnlCalendar month="2026-09" days={days} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "2026-09-04: +$269, 2 trades" })).toBeTruthy();
    expect(screen.getByTestId("week-2026-08-31").textContent).toContain("+$679");
    expect(screen.getByTestId("week-2026-09-07").textContent).toContain("+$42");
    expect(screen.getByTestId("week-2026-09-14").textContent).toContain("—");
  });

  it("dims a holiday and names it on hover", () => {
    render(<PnlCalendar month="2026-09" days={days} selected={null} onSelect={() => {}} />);
    expect(screen.getByTitle("Labor Day")).toBeTruthy();
  });

  it("hands back the day that was clicked", () => {
    const onSelect = vi.fn();
    render(<PnlCalendar month="2026-09" days={days} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /^2026-09-10:/ }));
    expect(onSelect).toHaveBeenCalledWith("2026-09-10");
  });

  it("counts a close dated on a weekend in its week's total, so the weeks add up to the month", () => {
    const weekend = new Map<string, CalendarDay>([["2026-09-05", { net: 100, trades: [1] }]]);
    render(<PnlCalendar month="2026-09" days={weekend} selected={null} onSelect={() => {}} />);
    expect(screen.getByTestId("week-2026-08-31").textContent).toContain("+$100");
  });
});
