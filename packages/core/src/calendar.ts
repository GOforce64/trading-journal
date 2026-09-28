import { nyDate } from "./marks.js";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const NY_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function clock(epochMs: number) {
  const parts = NY_CLOCK.formatToParts(new Date(epochMs));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((found) => found.type === type)?.value ?? "";
  return { weekday: part("weekday") as Weekday, hour: Number(part("hour")), minute: Number(part("minute")) };
}

/** The weekday in New York at an instant. */
export const nyWeekday = (epochMs: number): Weekday => clock(epochMs).weekday;

/** Minutes since midnight in New York at an instant. */
export function nyMinuteOfDay(epochMs: number): number {
  const { hour, minute } = clock(epochMs);
  return hour * 60 + minute;
}

const DAY = 86_400_000;
const utcMidnight = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** A YYYY-MM-DD date moved by whole days. */
export const addDays = (date: string, days: number): string =>
  new Date(utcMidnight(date) + days * DAY).toISOString().slice(0, 10);

/** 0 = Sunday … 6 = Saturday. */
const dayOfWeek = (date: string) => new Date(utcMidnight(date)).getUTCDay();

/** The weekday of a YYYY-MM-DD date. */
export const weekdayOfDate = (date: string): Weekday => WEEKDAYS[(dayOfWeek(date) + 6) % 7] ?? "Mon";

const pad = (value: number) => String(value).padStart(2, "0");
const ymd = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

/** Easter Sunday in the Gregorian calendar (the anonymous Meeus/Jones/Butcher algorithm). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** The nth given weekday (0 = Sunday) of a month; n = -1 is the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = ymd(year, month, 1);
    return addDays(first, ((weekday - dayOfWeek(first) + 7) % 7) + (n - 1) * 7);
  }
  const last = addDays(ymd(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1), -1);
  return addDays(last, -((dayOfWeek(last) - weekday + 7) % 7));
}

/** A fixed-date holiday on a weekend is observed on the Friday before or the Monday after. */
function observed(date: string): string {
  const weekday = dayOfWeek(date);
  if (weekday === 6) return addDays(date, -1);
  if (weekday === 0) return addDays(date, 1);
  return date;
}

/** One-off closures that no rule predicts. */
const CLOSURES: Record<string, string> = {
  "2025-01-09": "National Day of Mourning",
};

/** The NYSE's full-day holidays in a year, by date, with their names. */
export function nyseHolidays(year: number): Map<string, string> {
  const holidays = new Map<string, string>();
  const newYear = ymd(year, 1, 1);
  // A Saturday New Year's Day is not observed on the last trading day of the year before.
  if (dayOfWeek(newYear) !== 6) holidays.set(observed(newYear), "New Year's Day");
  holidays.set(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  holidays.set(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  holidays.set(addDays(easterSunday(year), -2), "Good Friday");
  holidays.set(nthWeekday(year, 5, 1, -1), "Memorial Day");
  if (year >= 2022) holidays.set(observed(ymd(year, 6, 19)), "Juneteenth");
  holidays.set(observed(ymd(year, 7, 4)), "Independence Day");
  holidays.set(nthWeekday(year, 9, 1, 1), "Labor Day");
  holidays.set(nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
  holidays.set(observed(ymd(year, 12, 25)), "Christmas Day");
  for (const [date, name] of Object.entries(CLOSURES)) {
    if (date.startsWith(`${year}-`)) holidays.set(date, name);
  }
  return holidays;
}

const byYear = new Map<number, Map<string, string>>();

/** The holiday's name when the NYSE is closed for one on this date, else null. */
export function holidayName(date: string): string | null {
  const year = Number(date.slice(0, 4));
  let holidays = byYear.get(year);
  if (!holidays) {
    holidays = nyseHolidays(year);
    byYear.set(year, holidays);
  }
  return holidays.get(date) ?? null;
}

/** A weekday that is not an NYSE holiday. */
export function isTradingDay(date: string): boolean {
  const weekday = dayOfWeek(date);
  return weekday !== 0 && weekday !== 6 && holidayName(date) === null;
}

/** Trading days after the open date, up to and including the close date. */
export function sessionsBetween(openDate: string, closeDate: string): number {
  let sessions = 0;
  for (let date = addDays(openDate, 1); date <= closeDate; date = addDays(date, 1)) {
    if (isTradingDay(date)) sessions++;
  }
  return sessions;
}

export const HOLD_BUCKETS = ["same day", "overnight", "1 full day", "weekend", "longer", "unknown"] as const;
export type HoldBucket = (typeof HOLD_BUCKETS)[number];

const NOON = 12 * 60;

/** How long a trade was held, in the terms of the earnings-fly strategy (spec §5.4). */
export function holdBucket(openedAt: number, closedAt: number): HoldBucket {
  if (!Number.isFinite(openedAt) || !Number.isFinite(closedAt) || closedAt < openedAt) return "unknown";
  const openDate = nyDate(openedAt);
  const closeDate = nyDate(closedAt);
  const sessions = sessionsBetween(openDate, closeDate);
  if (sessions === 0) return "same day";
  if (sessions > 1) return "longer";
  for (let date = addDays(openDate, 1); date < closeDate; date = addDays(date, 1)) {
    if (dayOfWeek(date) === 6) return "weekend";
  }
  return nyMinuteOfDay(closedAt) < NOON ? "overnight" : "1 full day";
}

const HOUR = 3_600_000;

/**
 * The instant a New York wall-clock time happens. UTC = NY wall clock − NY's offset, so 16:00 in
 * daylight time (UTC−4) is 20:00Z. The offset is found by trying both and keeping the one that reads back.
 */
export function nyWallClock(date: string, minuteOfDay: number): number {
  const asIfUtc = utcMidnight(date) + minuteOfDay * 60_000;
  for (const hours of [4, 5]) {
    const at = asIfUtc + hours * HOUR;
    if (nyDate(at) === date && nyMinuteOfDay(at) === minuteOfDay) return at;
  }
  // Only a time the spring change skips (02:00–02:59) gets here, never a market time.
  return asIfUtc + 5 * HOUR;
}

/** 09:31: the first minute bar, stamped 09:30, has closed. */
const FIRST_BAR_CLOSE = 9 * 60 + 31;
const MARKET_CLOSE = 16 * 60;

/**
 * The moment whose stock price stands for `at`: its New York minute, clamped into 09:31–16:00 on its
 * own date. Some stored times fall outside market hours (spec §2), and the seconds are dropped.
 */
export function sessionMoment(at: number): number {
  const minute = Math.min(Math.max(nyMinuteOfDay(at), FIRST_BAR_CLOSE), MARKET_CLOSE);
  return nyWallClock(nyDate(at), minute);
}

/** Options expire at 16:00 New York on their expiry date. */
export const expiryMoment = (expiry: string): number => nyWallClock(expiry, MARKET_CLOSE);
