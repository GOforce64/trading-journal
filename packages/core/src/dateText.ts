import { nyMinuteOfDay } from "./calendar.js";
import { nyDate } from "./marks.js";

/**
 * Every date the app shows or reads, the European way (launcher-keys-palette spec §8): day first, the month as a
 * short name, 24-hour times; typed dates day/month/year. No Intl, so the browser's language can't change it.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** An instant (epoch ms, read in New York) or a calendar date ("2026-09-28", shown as is). */
export type When = number | string;

const isoOf = (when: When) => (typeof when === "number" ? nyDate(when) : when);
const pad = (value: number) => String(value).padStart(2, "0");

/** "Sep", for "2026-09" or "2026-09-28". */
export const monthName = (date: string): string => MONTHS[Number(date.slice(5, 7)) - 1] ?? "";

/** "28 Sep". */
export function dayText(when: When): string {
  const iso = isoOf(when);
  return `${Number(iso.slice(8, 10))} ${monthName(iso)}`;
}

/** "28 Sep 2026". */
export const dayYearText = (when: When): string => `${dayText(when)} ${isoOf(when).slice(0, 4)}`;

/** "09:35", or "09:35:12" with seconds, on New York's clock. */
export function clockText(at: number, { seconds = false }: { seconds?: boolean } = {}): string {
  const minute = nyMinuteOfDay(at);
  const time = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
  // New York's offset is whole hours, so the seconds are UTC's.
  return seconds ? `${time}:${pad(new Date(at).getUTCSeconds())}` : time;
}

/** "28 Sep 09:35"; "28 Sep 2026 09:35" with `year`; "28 Sep 09:35:12" with `seconds`. */
export function dayTimeText(at: number, options: { year?: boolean; seconds?: boolean } = {}): string {
  return `${options.year ? dayYearText(at) : dayText(at)} ${clockText(at, options)}`;
}

/** "2026-09" → "Sep 2026", or "September 2026" with `long`. */
export function monthText(month: string, { long = false }: { long?: boolean } = {}): string {
  const name = long ? LONG_MONTHS[Number(month.slice(5, 7)) - 1] : monthName(month);
  return `${name} ${month.slice(0, 4)}`;
}

/** "2026-12-09" → "09/12/2026", as a date field shows it. */
export const fieldDate = (date: string): string =>
  `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const isoDate = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const real = (year: number, month: number, day: number) =>
  month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;
const DM = /^(\d{1,2})[/.-](\d{1,2})$/;

/** A typed date, day/month/year (spec §8.2): "9/12/26", "09.12.2026", "9-12-2026", or ISO. Null if it isn't one. */
export function parseDayMonthYear(text: string): string | null {
  const trimmed = text.trim();
  const iso = ISO.exec(trimmed);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return real(year, month, day) ? isoDate(year, month, day) : null;
  }
  const typed = DMY.exec(trimmed);
  if (!typed) return null;
  const [day, month] = [Number(typed[1]), Number(typed[2])];
  const yearText = typed[3] ?? "";
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  return real(year, month, day) ? isoDate(year, month, day) : null;
}

/** A day and month with no year ("9/12"): the latest such date on or before `today`, as the palette reads it. */
export function parseDayMonth(text: string, today: string): string | null {
  const typed = DM.exec(text.trim());
  if (!typed) return null;
  const [day, month] = [Number(typed[1]), Number(typed[2])];
  const thisYear = Number(today.slice(0, 4));
  // Eight years back reaches the last 29 February.
  for (let year = thisYear; year >= thisYear - 8; year -= 1) {
    if (!real(year, month, day)) continue;
    const date = isoDate(year, month, day);
    if (date <= today) return date;
  }
  return null;
}

/** "2026-09-28T09:31:05" → "28/09/2026 09:31:05", as a date-and-time field shows a wall-clock value. */
export const fieldDateTime = (value: string): string => `${fieldDate(value.slice(0, 10))} ${value.slice(11)}`;

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * A typed date and time, day/month/year then a 24-hour time: "28/9/26 9:35", "28/09/2026 15:57:05", or ISO
 * ("2026-09-28T09:35", with a space or a T). Gives the wall-clock value "2026-09-28T09:35[:05]", or null.
 */
export function parseDayMonthYearTime(text: string): string | null {
  const parts = text.trim().split(/\s+|T(?=\d{1,2}:)/);
  if (parts.length !== 2) return null;
  const date = parseDayMonthYear(parts[0] ?? "");
  const time = TIME.exec(parts[1] ?? "");
  if (!date || !time) return null;
  const [hour, minute] = [Number(time[1]), Number(time[2])];
  const second = time[3] == null ? null : Number(time[3]);
  if (hour > 23 || minute > 59 || (second != null && second > 59)) return null;
  return `${date}T${pad(hour)}:${pad(minute)}${second == null ? "" : `:${pad(second)}`}`;
}
