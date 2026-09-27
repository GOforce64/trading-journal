import { addDays, WEEKDAYS, weekdayOfDate } from "@tj/core";

/** "2026-09-27" → "2026-09". */
export const monthOf = (date: string) => date.slice(0, 7);

/** A YYYY-MM month moved by whole months. */
export function shiftMonth(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export const firstDay = (month: string) => `${month}-01`;
export const lastDay = (month: string) => addDays(firstDay(shiftMonth(month, 1)), -1);

/** The Monday-to-Sunday weeks that touch a month, as YYYY-MM-DD dates. */
export function monthWeeks(month: string): string[][] {
  const first = firstDay(month);
  const end = lastDay(month);
  const weeks: string[][] = [];
  for (
    let monday = addDays(first, -WEEKDAYS.indexOf(weekdayOfDate(first)));
    monday <= end;
    monday = addDays(monday, 7)
  ) {
    weeks.push(Array.from({ length: 7 }, (_, day) => addDays(monday, day)));
  }
  return weeks;
}
