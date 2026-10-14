import {
  addDays,
  nyDate,
  parseDayMonth,
  parseDayMonthYear,
  type Strategy,
  WEEKDAYS,
  weekdayOfDate,
} from "@tj/core";

/** One word of a palette query, read (launcher-keys-palette spec §7.3). */
export type Word =
  | { kind: "day"; date: string }
  | { kind: "month"; month: string }
  | { kind: "strategy"; strategy: Strategy }
  | { kind: "book"; book: "live" | "paper" | "missed" }
  | { kind: "ticker"; ticker: string; exact: boolean }
  | { kind: "setup"; ids: string[]; text: string }
  | { kind: "unknown"; text: string };

export interface QueryContext {
  /** New York's today, YYYY-MM-DD. */
  today: string;
  tickers: ReadonlySet<string>;
  setups: readonly { id: string; name: string }[];
}

export interface PaletteTrade {
  id: string;
  openedAt: number;
  underlying: string;
  strategy: string;
  book: string;
  setupId: string | null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const LONG_MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
/** Index into WEEKDAYS (Monday first). */
const WEEKDAY_WORDS: Record<string, number> = {
  mon: 0,
  monday: 0,
  tue: 1,
  tues: 1,
  tuesday: 1,
  wed: 2,
  wednesday: 2,
  thu: 3,
  thur: 3,
  thurs: 3,
  thursday: 3,
  fri: 4,
  friday: 4,
  sat: 5,
  saturday: 5,
  sun: 6,
  sunday: 6,
};
const STRATEGIES: Record<string, Strategy> = {
  scalp: "scalp",
  scalps: "scalp",
  swing: "swing",
  swings: "swing",
  fly: "iron_fly",
  flies: "iron_fly",
  iron: "iron_fly",
};
const BOOKS: Record<string, "live" | "paper" | "missed"> = { live: "live", paper: "paper", missed: "missed" };

function dayOf(word: string, today: string): string | null {
  if (word === "today") return today;
  if (word === "yesterday") return addDays(today, -1);
  const weekday = WEEKDAY_WORDS[word];
  if (weekday !== undefined) {
    // The latest such day on or before today.
    return addDays(today, -((WEEKDAYS.indexOf(weekdayOfDate(today)) - weekday + 7) % 7));
  }
  return parseDayMonthYear(word) ?? parseDayMonth(word, today);
}

function monthOf(word: string, today: string): string | null {
  const iso = /^(\d{4})-(\d{2})$/.exec(word);
  if (iso) return Number(iso[2]) >= 1 && Number(iso[2]) <= 12 ? word : null;
  const at = Math.max(MONTHS.indexOf(word), LONG_MONTHS.indexOf(word));
  if (at < 0) return null;
  // A month with no year is its latest, this one included.
  const year = Number(today.slice(0, 4)) - (at + 1 > Number(today.slice(5, 7)) ? 1 : 0);
  return `${year}-${String(at + 1).padStart(2, "0")}`;
}

function oneWord(word: string, ctx: QueryContext): Word | null {
  const date = dayOf(word, ctx.today);
  if (date) return { kind: "day", date };
  const month = monthOf(word, ctx.today);
  if (month) return { kind: "month", month };
  const strategy = STRATEGIES[word];
  if (strategy) return { kind: "strategy", strategy };
  const book = BOOKS[word];
  if (book) return { kind: "book", book };
  if (ctx.tickers.has(word.toUpperCase())) return { kind: "ticker", ticker: word.toUpperCase(), exact: true };
  return null;
}

/** The longest run of words from `start`, at least `least` long, that starts some setups' names. */
function setupRun(words: readonly string[], start: number, least: number, ctx: QueryContext) {
  for (let end = words.length; end - start >= least; end -= 1) {
    const text = words.slice(start, end).join(" ");
    const ids = ctx.setups
      .filter((setup) => setup.name.toLowerCase().startsWith(text))
      .map((setup) => setup.id);
    if (ids.length > 0) return { word: { kind: "setup" as const, ids, text }, end };
  }
  return null;
}

/**
 * Reads a query (spec §7.3, refined in the plan): a setup named by two or more words first; then a day, a month,
 * a strategy or book, an exact ticker, a one-word setup, a ticker prefix; anything else is unknown.
 */
export function parseTradeQuery(text: string, ctx: QueryContext): Word[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const read: Word[] = [];
  let at = 0;
  while (at < words.length) {
    const word = words[at] as string;
    const run = setupRun(words, at, 2, ctx);
    const single = run ? null : oneWord(word, ctx);
    const setup = run ?? (single ? null : setupRun(words, at, 1, ctx));
    if (setup) {
      read.push(setup.word);
      at = setup.end;
      continue;
    }
    if (single) {
      read.push(single);
    } else {
      const upper = word.toUpperCase();
      const prefix = [...ctx.tickers].some((ticker) => ticker.startsWith(upper));
      read.push(prefix ? { kind: "ticker", ticker: upper, exact: false } : { kind: "unknown", text: word });
    }
    at += 1;
  }
  return read;
}

function fits(trade: PaletteTrade, word: Word): boolean {
  switch (word.kind) {
    case "day":
      return nyDate(trade.openedAt) === word.date;
    case "month":
      return nyDate(trade.openedAt).slice(0, 7) === word.month;
    case "strategy":
      return trade.strategy === word.strategy;
    case "book":
      return trade.book === word.book;
    case "ticker":
      return word.exact ? trade.underlying === word.ticker : trade.underlying.startsWith(word.ticker);
    case "setup":
      return trade.setupId != null && word.ids.includes(trade.setupId);
    case "unknown":
      return false;
  }
}

/** The trades every word fits, newest first; none for an empty query or one with an unknown word. */
export function matchTrades<T extends PaletteTrade>(trades: readonly T[], words: readonly Word[]): T[] {
  if (words.length === 0 || words.some((word) => word.kind === "unknown")) return [];
  return trades
    .filter((trade) => words.every((word) => fits(trade, word)))
    .sort((a, b) => b.openedAt - a.openedAt);
}
