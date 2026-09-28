const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthDayTime {
  /** 1-12 */
  month: number;
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
}

/** oQuants shows "Sep 9, 8:54 PM", sometimes followed by "(1d)". It never shows the year. */
export function parseOquantsDate(text: string): MonthDayTime | null {
  const match = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{1,2}):(\d{2}) ?([AP]M)/.exec(
    text.replace(/\s+/g, " ").trim(),
  );
  if (!match) return null;
  const [, monthName, day, hour, minute, half] = match;
  const month = MONTHS.indexOf(monthName ?? "") + 1;
  const hour12 = Number(hour);
  if (month === 0 || hour12 < 1 || hour12 > 12) return null;
  return { month, day: Number(day), hour: (hour12 % 12) + (half === "PM" ? 12 : 0), minute: Number(minute) };
}

/** How far `timeZone`'s wall clock is ahead of UTC at `epochMs`. */
function offsetMs(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(epochMs);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return wall - Math.floor(epochMs / 60_000) * 60_000;
}

/** A wall-clock time in `timeZone` as epoch ms. The second pass settles times near a DST switch. */
export function zonedTimeToEpoch(year: number, time: MonthDayTime, timeZone: string): number {
  const wall = Date.UTC(year, time.month - 1, time.day, time.hour, time.minute);
  const firstGuess = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(firstGuess, timeZone);
}
