import {
  addDays,
  BREAKDOWNS,
  type Breakdown,
  MISSED_BREAKDOWNS,
  type MissedBreakdown,
  parseEdges,
  WEEKDAYS,
  weekdayOfDate,
} from "@tj/core";
import type { Book, TradeFilter } from "./data.js";
import { firstDay, lastDay, monthOf, shiftMonth } from "./dates.js";

/** The Analytics page's URL state. Defaults are left out, so the URL stays short (spec §7.1). */
export interface AnalyticsSearch {
  tab?: "scalps" | "flies" | "missed";
  from?: string;
  to?: string;
  /** One book; absent means both. */
  books?: Book;
  ticker?: string;
  /** A setup's id (scalp-analytics spec §5.2). */
  setup?: string;
  excluded?: true;
  /** The Scalps tab's breakdown; absent means by setup. */
  by?: Exclude<Breakdown, "setup">;
  /** What the Scalps tab's bars show; absent means net P&L. */
  metric?: "r" | "win";
  creditEdges?: string;
  contractEdges?: string;
  /** The Scalps tab's option-cost edges. */
  costEdges?: string;
  /** The Missed tab's breakdown (missed-trades spec §6.6); absent means by skip reason. */
  mby?: Exclude<MissedBreakdown, "skip">;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A ticker such as M, BRK.B, BF-B or BRK/B. */
const TICKER = /^[A-Z][A-Z0-9./-]{0,9}$/;
/** A setup id: a UUID, or a seeded id like "orb". */
const SETUP_ID = /^[A-Za-z0-9-]{1,64}$/;

/** The router parses plain values as JSON, so "250" may arrive as a number. */
const text = (value: unknown) =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;

/** A real calendar date: Date.parse would roll 2026-02-30 over to March 2. */
function isDate(value: string | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(value);
}

/** Keeps what's valid and drops the rest, so an old or hand-edited link still opens. */
export function parseAnalyticsSearch(raw: Record<string, unknown>): AnalyticsSearch {
  const search: AnalyticsSearch = {};
  if (raw.tab === "scalps" || raw.tab === "flies" || raw.tab === "missed") search.tab = raw.tab;
  const from = text(raw.from);
  if (isDate(from)) search.from = from;
  const to = text(raw.to);
  if (isDate(to)) search.to = to;
  if (raw.books === "live" || raw.books === "paper") search.books = raw.books;
  const ticker = text(raw.ticker)?.toUpperCase();
  if (ticker && TICKER.test(ticker)) search.ticker = ticker;
  const setup = text(raw.setup);
  if (setup && SETUP_ID.test(setup)) search.setup = setup;
  // The spec writes excluded=1; the page writes excluded=true.
  if ([true, "true", 1, "1"].includes(raw.excluded as never)) search.excluded = true;
  const by = BREAKDOWNS.find((each) => each === raw.by);
  if (by && by !== "setup") search.by = by;
  if (raw.metric === "r" || raw.metric === "win") search.metric = raw.metric;
  const creditEdges = text(raw.creditEdges);
  if (creditEdges && parseEdges(creditEdges, "usd")) search.creditEdges = creditEdges;
  const contractEdges = text(raw.contractEdges);
  if (contractEdges && parseEdges(contractEdges, "contracts")) search.contractEdges = contractEdges;
  const mby = MISSED_BREAKDOWNS.find((each) => each === raw.mby);
  if (mby && mby !== "skip") search.mby = mby;
  const costEdges = text(raw.costEdges);
  if (costEdges && parseEdges(costEdges, "usd")) search.costEdges = costEdges;
  return search;
}

export function toFilter(search: AnalyticsSearch): TradeFilter {
  const filter: TradeFilter = {
    books: search.books ? [search.books] : ["live", "paper"],
    includeExcluded: search.excluded === true,
  };
  if (search.ticker) filter.ticker = search.ticker;
  if (search.setup) filter.setup = search.setup;
  if (search.from) filter.from = search.from;
  if (search.to) filter.to = search.to;
  return filter;
}

/** The search after a change. A key set to undefined is removed, so defaults stay out of the URL. */
export function applyPatch<S extends object>(prev: S, patch: Partial<S>): S {
  return Object.fromEntries(
    Object.entries({ ...prev, ...patch }).filter(([, value]) => value !== undefined),
  ) as S;
}

export const DATE_PRESETS = [
  { id: "all", label: "All time" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-90", label: "Last 90 days" },
  { id: "this-year", label: "This year" },
] as const;

export type PresetId = (typeof DATE_PRESETS)[number]["id"];

export function presetRange(preset: PresetId, today: string): { from?: string; to?: string } {
  const month = monthOf(today);
  const year = today.slice(0, 4);
  switch (preset) {
    case "this-month":
      return { from: firstDay(month), to: lastDay(month) };
    case "last-month": {
      const previous = shiftMonth(month, -1);
      return { from: firstDay(previous), to: lastDay(previous) };
    }
    case "last-90":
      return { from: addDays(today, -89), to: today };
    case "this-year":
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    default:
      return {};
  }
}

/** The preset a range matches, or "custom". */
export function activePreset(range: { from?: string; to?: string }, today: string): PresetId | "custom" {
  const match = DATE_PRESETS.find(({ id }) => {
    const preset = presetRange(id, today);
    return preset.from === range.from && preset.to === range.to;
  });
  return match?.id ?? "custom";
}

export type Period = "week" | "month" | "year" | "all";

/** The Dashboard's URL state: month and today are the defaults, left out. */
export interface DashboardSearch {
  period?: "week" | "year" | "all";
  at?: string;
}

export function parseDashboardSearch(raw: Record<string, unknown>): DashboardSearch {
  const search: DashboardSearch = {};
  if (raw.period === "week" || raw.period === "year" || raw.period === "all") search.period = raw.period;
  const at = text(raw.at);
  if (isDate(at)) search.at = at;
  return search;
}

/** The dates a period covers; a week runs Monday to Sunday. */
export function periodRange(period: Period, at: string): { from?: string; to?: string } {
  switch (period) {
    case "week": {
      const monday = addDays(at, -WEEKDAYS.indexOf(weekdayOfDate(at)));
      return { from: monday, to: addDays(monday, 6) };
    }
    case "month":
      return { from: firstDay(monthOf(at)), to: lastDay(monthOf(at)) };
    case "year":
      return { from: `${at.slice(0, 4)}-01-01`, to: `${at.slice(0, 4)}-12-31` };
    default:
      return {};
  }
}

/** A date inside the period before or after. */
export function stepPeriod(period: Period, at: string, step: 1 | -1): string {
  switch (period) {
    case "week":
      return addDays(at, 7 * step);
    case "month":
      return firstDay(shiftMonth(monthOf(at), step));
    case "year":
      return `${Number(at.slice(0, 4)) + step}-01-01`;
    default:
      return at;
  }
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export function periodLabel(period: Period, at: string): string {
  const { from = at, to = at } = periodRange(period, at);
  switch (period) {
    case "week":
      return `${MONTH_DAY.format(utc(from))} – ${MONTH_DAY.format(utc(to))}, ${to.slice(0, 4)}`;
    case "month":
      return MONTH_YEAR.format(utc(at));
    case "year":
      return at.slice(0, 4);
    default:
      return "All time";
  }
}

/** The month the calendar opens on: today's when the period includes today, else the period's last month. */
export function calendarMonth(period: Period, at: string, today: string): string {
  const { from, to } = periodRange(period, at);
  if (!to || ((!from || from <= today) && today <= to)) return monthOf(today);
  return monthOf(to);
}
