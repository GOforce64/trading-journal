import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addDays,
  isTradingDay,
  nyDate,
  nyWallClock,
  REGULAR_OPEN,
  regularClose,
  reviewStatus,
  tradeMoves,
} from "@tj/core";
import { createBarsRepo, createTradesRepo, type Db, openDatabase, runMigrations } from "@tj/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateDemo, lastFinishedSession } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../db/migrations", import.meta.url));
const END = "2026-12-31";
const dirs: string[] = [];

/** A migrated journal in a temp directory, removed after the tests. */
function freshJournal(): Db {
  const dir = mkdtempSync(join(tmpdir(), "tj-demo-"));
  dirs.push(dir);
  const file = join(dir, "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  return openDatabase(file);
}

/** A trade's open and close each inside a session: 09:30 to that date's close. */
function expectInSession(trade: { openedAt: number; closedAt: number | null }) {
  for (const at of [trade.openedAt, trade.closedAt ?? trade.openedAt]) {
    const date = nyDate(at);
    expect(isTradingDay(date)).toBe(true);
    expect(at).toBeGreaterThanOrEqual(nyWallClock(date, REGULAR_OPEN));
    expect(at).toBeLessThan(nyWallClock(date, regularClose(date)));
  }
}

const datesFrom = (from: string, to: string) => {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
};

let db: Db;
let summary: ReturnType<typeof generateDemo>;
// A month takes about half a second here; Windows CI can be several times slower.
beforeAll(() => {
  db = freshJournal();
  summary = generateDemo(db, { end: END, months: 1 });
}, 30_000);
afterAll(() => {
  db.$client.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("generateDemo", () => {
  it("makes a month of closed scalps and flies in the live and paper books", () => {
    expect(summary.scalps).toBeGreaterThanOrEqual(15);
    expect(summary.scalps).toBeLessThanOrEqual(80);
    expect(summary.flies).toBeGreaterThanOrEqual(1);
    expect(summary.to).toBe(END);
    const trades = createTradesRepo(db).list();
    expect(trades).toHaveLength(summary.scalps + summary.flies);
    for (const trade of trades) {
      expect(trade.closedAt).not.toBeNull();
      expect(["live", "paper"]).toContain(trade.book);
    }
  });

  it("adds up every trade's P&L from its legs less its fees", () => {
    for (const trade of createTradesRepo(db).list()) {
      const legs = trade.legs.reduce(
        (sum, leg) => sum + ((leg.closePrice ?? 0) - leg.openPrice) * leg.quantity * leg.multiplier,
        0,
      );
      expect(trade.netPnl).toBeCloseTo(legs - trade.fees, 1);
    }
  });

  it("trades only inside sessions, and stops a half day's bars at 13:00", () => {
    for (const trade of createTradesRepo(db).list()) expectInSession(trade);
    const halfDays = ["SPY", "QQQ", "NVDA", "TSLA"]
      .map((symbol) =>
        createBarsRepo(db).read(symbol, "1m", nyWallClock("2026-12-24", 0), nyWallClock("2026-12-25", 0)),
      )
      .filter((bars) => bars.length > 0);
    expect(halfDays.length).toBeGreaterThan(0);
    for (const bars of halfDays) {
      expect(bars).toHaveLength(210);
      expect(bars.at(-1)?.t).toBe(nyWallClock("2026-12-24", 12 * 60 + 59));
    }
  });

  it("knows every day each trade's charts ask for, so they draw without a key", () => {
    const bars = createBarsRepo(db);
    for (const trade of createTradesRepo(db).list()) {
      const lastDay = nyDate(trade.closedAt ?? trade.openedAt);
      const minuteDays = datesFrom(addDays(nyDate(trade.openedAt), -7), lastDay);
      expect(bars.knownDays(trade.underlying, "1m", minuteDays).size).toBe(minuteDays.length);
      const dailyDays = datesFrom(addDays(lastDay, -1_095), lastDay);
      expect(bars.knownDays(trade.underlying, "1d", dailyDays).size).toBe(dailyDays.length);
    }
  });

  it("leaves the last three sessions' scalps to review, and the rest reviewed, each with its prices", () => {
    const scalps = createTradesRepo(db).list({ strategy: "scalp" });
    const statuses = scalps.map((trade) => ({
      date: nyDate(trade.openedAt),
      status: reviewStatus(trade)?.status,
    }));
    const recent = statuses.filter((each) => each.date >= "2026-12-29");
    expect(statuses.filter((each) => each.date < "2026-12-28").every((each) => each.status === "done")).toBe(
      true,
    );
    expect(recent.some((each) => each.status === "pending")).toBe(true);
    for (const trade of scalps) expect(trade.scalpPrices?.entryPrice).toBeGreaterThan(0);
  });

  it("leaves a fly's moves and IVs for the app to work out from its fills, as a synced fly's are", () => {
    const flies = createTradesRepo(db).list({ strategy: "iron_fly" });
    expect(flies.length).toBeGreaterThan(0);
    for (const fly of flies) {
      expect(fly.ironFly).toMatchObject({
        impliedMovePct: null,
        actualMovePct: null,
        ivBefore: null,
        ivAfter: null,
      });
      const moves = tradeMoves(fly);
      expect(moves.impliedMove?.source).toBe("computed");
      expect(moves.actualMove?.source).toBe("computed");
      expect(moves.ivBefore?.source).toBe("computed");
    }
  });

  it("makes the same trades again from the same seed", { timeout: 30_000 }, () => {
    const again = freshJournal();
    generateDemo(again, { end: END, months: 1 });
    const content = (journal: Db) =>
      createTradesRepo(journal)
        .list()
        .map((trade) => ({
          underlying: trade.underlying,
          openedAt: trade.openedAt,
          closedAt: trade.closedAt,
          netPnl: trade.netPnl,
          legs: trade.legs.map(({ right, strike, expiry, quantity, openPrice, closePrice }) => ({
            right,
            strike,
            expiry,
            quantity,
            openPrice,
            closePrice,
          })),
        }));
    expect(content(again)).toEqual(content(db));
    again.$client.close();
  });
});

describe("generateDemo around a half day", () => {
  it("keeps a fly entering the day after Thanksgiving inside its 13:00 close", { timeout: 30_000 }, () => {
    const journal = freshJournal();
    // ADBE reports after the close on Nov 27, a 13:00 half day, with this seed and end.
    expect(() => generateDemo(journal, { end: "2026-12-07", months: 1 })).not.toThrow();
    for (const trade of createTradesRepo(journal).list()) expectInSession(trade);
    journal.$client.close();
  });
});

describe("lastFinishedSession", () => {
  it("is the last session before today in New York", () => {
    expect(lastFinishedSession(nyWallClock("2026-11-28", 12 * 60))).toBe("2026-11-27");
    expect(lastFinishedSession(nyWallClock("2026-11-26", 12 * 60))).toBe("2026-11-25");
    expect(lastFinishedSession(nyWallClock("2026-12-01", 10 * 60))).toBe("2026-11-30");
  });
});
