import type { PriceBar } from "@tj/core";
import { and, asc, between, eq, inArray } from "drizzle-orm";
import type { Db } from "../client.js";
import { barDays, bars } from "../schema.js";

export type BarTimeframe = "1m" | "1d";

/** The chart's bar cache (trade-chart spec §5). Only finished days are stored, so nothing here goes stale. */
export function createBarsRepo(db: Db) {
  return {
    /** Which of `dates` are cached, empty days included. */
    knownDays(symbol: string, timeframe: BarTimeframe, dates: readonly string[]): Set<string> {
      if (dates.length === 0) return new Set();
      const rows = db
        .select({ date: barDays.date })
        .from(barDays)
        .where(
          and(
            eq(barDays.symbol, symbol),
            eq(barDays.timeframe, timeframe),
            inArray(barDays.date, [...dates]),
          ),
        )
        .all();
      return new Set(rows.map((row) => row.date));
    },

    /** Cached bars that start between `from` and `to` (epoch ms, inclusive), oldest first. */
    read(symbol: string, timeframe: BarTimeframe, from: number, to: number): PriceBar[] {
      return db
        .select({ t: bars.t, o: bars.o, h: bars.h, l: bars.l, c: bars.c, v: bars.v })
        .from(bars)
        .where(and(eq(bars.symbol, symbol), eq(bars.timeframe, timeframe), between(bars.t, from, to)))
        .orderBy(asc(bars.t))
        .all();
    },

    /** Stores finished days, each with its bars (possibly none), in one transaction. A stored day is kept as it was. */
    store(
      symbol: string,
      timeframe: BarTimeframe,
      days: readonly { date: string; bars: readonly PriceBar[] }[],
      fetchedAt: number,
    ): void {
      // One prepared statement run a row at a time: building SQL for each insert made three years of bars take seconds.
      const insertBar = db.$client.prepare(
        "insert into bars (symbol, timeframe, t, o, h, l, c, v) values (?, ?, ?, ?, ?, ?, ?, ?) on conflict do nothing",
      );
      const insertDay = db.$client.prepare(
        "insert into bar_days (symbol, timeframe, date, count, fetched_at) values (?, ?, ?, ?, ?) on conflict do nothing",
      );
      db.$client.transaction(() => {
        for (const day of days) {
          for (const bar of day.bars)
            insertBar.run(symbol, timeframe, bar.t, bar.o, bar.h, bar.l, bar.c, bar.v);
          insertDay.run(symbol, timeframe, day.date, day.bars.length, fetchedAt);
        }
      })();
    },
  };
}
