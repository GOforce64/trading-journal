import { describe, expect, it } from "vitest";
import {
  clockText,
  dayText,
  dayTimeText,
  dayYearText,
  fieldDate,
  fieldDateTime,
  monthName,
  monthOfText,
  monthText,
  parseDayMonth,
  parseDayMonthYear,
  parseDayMonthYearTime,
} from "./dateText.js";

// 09:35:12 in New York on 28 Sep 2026 (EDT, UTC−4).
const MORNING = Date.UTC(2026, 8, 28, 13, 35, 12);

describe("dates shown", () => {
  it("writes the day first, in New York", () => {
    expect(dayText(MORNING)).toBe("28 Sep");
    expect(dayYearText(MORNING)).toBe("28 Sep 2026");
    // 23:30 in New York is already the 29th in Dublin and UTC.
    expect(dayText(Date.UTC(2026, 8, 29, 3, 30))).toBe("28 Sep");
    // Winter time (EST, UTC−5).
    expect(dayTimeText(Date.UTC(2026, 11, 9, 14, 30))).toBe("9 Dec 09:30");
  });

  it("shows a plain date as that date", () => {
    expect(dayText("2026-12-09")).toBe("9 Dec");
    expect(dayYearText("2026-01-01")).toBe("1 Jan 2026");
  });

  it("uses 24-hour times, with seconds when asked", () => {
    expect(clockText(MORNING)).toBe("09:35");
    expect(clockText(MORNING, { seconds: true })).toBe("09:35:12");
    expect(clockText(Date.UTC(2026, 8, 28, 21, 5))).toBe("17:05");
    expect(dayTimeText(MORNING)).toBe("28 Sep 09:35");
    expect(dayTimeText(MORNING, { year: true })).toBe("28 Sep 2026 09:35");
    expect(dayTimeText(MORNING, { seconds: true })).toBe("28 Sep 09:35:12");
  });

  it("names every month in three letters, never Sept", () => {
    const names = Array.from({ length: 12 }, (_, i) => monthName(`2026-${String(i + 1).padStart(2, "0")}`));
    expect(names).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
    expect(monthName("2026-09-28")).toBe("Sep");
  });

  it("writes months and field dates", () => {
    expect(monthText("2026-09")).toBe("Sep 2026");
    expect(monthText("2026-09", { long: true })).toBe("September 2026");
    expect(fieldDate("2026-12-09")).toBe("09/12/2026");
  });
});

describe("dates typed", () => {
  it.each([
    ["9/12/26", "2026-12-09"],
    ["09/12/2026", "2026-12-09"],
    ["9.12.26", "2026-12-09"],
    ["9-12-2026", "2026-12-09"],
    [" 9/12/2026 ", "2026-12-09"],
    ["2026-12-09", "2026-12-09"],
    ["29/2/2028", "2028-02-29"],
  ])("reads %s as %s", (text, date) => {
    expect(parseDayMonthYear(text)).toBe(date);
  });

  // A year before 1900 is a typo, not a trade's date: "0026" once came back as "26-12-09" (launcher spec §14).
  it.each([
    "31/02/2026",
    "9/28/2026",
    "29/2/2026",
    "9/12",
    "9/12/202",
    "2026-13-01",
    "",
    "abc",
    "09/12/0026",
    "0026-12-09",
    "1/1/1899",
  ])("refuses %s", (text) => {
    expect(parseDayMonthYear(text)).toBeNull();
  });

  it("reads a day and month as the latest such date on or before today", () => {
    expect(parseDayMonth("9/12", "2026-10-12")).toBe("2025-12-09");
    expect(parseDayMonth("12/10", "2026-10-12")).toBe("2026-10-12");
    expect(parseDayMonth("13.10", "2026-10-12")).toBe("2025-10-13");
    expect(parseDayMonth("29/2", "2026-10-12")).toBe("2024-02-29");
    expect(parseDayMonth("9/28", "2026-10-12")).toBeNull();
    expect(parseDayMonth("9/12/26", "2026-10-12")).toBeNull();
  });
});

describe("dates and times in a field", () => {
  it("shows a wall-clock date and time day first, with seconds only when it has them", () => {
    expect(fieldDateTime("2026-09-28T09:35")).toBe("28/09/2026 09:35");
    expect(fieldDateTime("2026-09-28T09:31:05")).toBe("28/09/2026 09:31:05");
  });

  it.each([
    ["28/9/26 9:35", "2026-09-28T09:35"],
    ["28/09/2026 09:35", "2026-09-28T09:35"],
    ["28.9.2026 15:57:05", "2026-09-28T15:57:05"],
    ["9-12-26 0:05", "2026-12-09T00:05"],
    [" 28/09/2026  09:35 ", "2026-09-28T09:35"],
    ["2026-09-28T09:35", "2026-09-28T09:35"],
    ["2026-09-28 09:31:05", "2026-09-28T09:31:05"],
  ])("reads %s as %s", (text, value) => {
    expect(parseDayMonthYearTime(text)).toBe(value);
  });

  it.each([
    "28/09/2026",
    "9/28/2026 09:35",
    "28/09/2026 24:00",
    "28/09/2026 09:60",
    "28/09/2026 9",
    "28/09/2026 09:35 PM",
    "",
  ])("refuses %s", (text) => {
    expect(parseDayMonthYearTime(text)).toBeNull();
  });
});

describe("monthOfText (missed spec §14)", () => {
  it("reads back every month monthText writes, short or long", () => {
    for (let month = 1; month <= 12; month++) {
      const key = `2026-${String(month).padStart(2, "0")}`;
      expect(monthOfText(monthText(key))).toBe(key);
      expect(monthOfText(monthText(key, { long: true }))).toBe(key);
    }
  });

  it("is null for anything else", () => {
    expect(monthOfText("Sept 2026")).toBeNull();
    expect(monthOfText("no setup")).toBeNull();
  });
});
