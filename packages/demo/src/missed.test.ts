import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { missedRisk, nyDate, nyMinuteOfDay } from "@tj/core";
import { createTaxonomyRepo, createTradesRepo, type Db, openDatabase, runMigrations } from "@tj/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateDemo } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../db/migrations", import.meta.url));
const END = "2026-12-31";
const dirs: string[] = [];

function freshJournal(): Db {
  const dir = mkdtempSync(join(tmpdir(), "tj-demo-missed-"));
  dirs.push(dir);
  const file = join(dir, "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  return openDatabase(file);
}

let db: Db;
let summary: ReturnType<typeof generateDemo>;
// Six months, as `pnpm demo` makes: a few seconds here, longer on Windows CI.
beforeAll(() => {
  db = freshJournal();
  summary = generateDemo(db, { end: END });
}, 120_000);
afterAll(() => {
  db.$client.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const missedTrades = () => createTradesRepo(db).list({ book: "missed" });

describe("the demo's missed trades", () => {
  it("makes about twenty over six months, apart from the taken trades", () => {
    expect(summary.missed).toBeGreaterThanOrEqual(15);
    expect(summary.missed).toBeLessThanOrEqual(25);
    expect(missedTrades()).toHaveLength(summary.missed);
    expect(createTradesRepo(db).list({ taken: true })).toHaveLength(summary.scalps + summary.flies);
  });

  it("marks each one sensibly: early in the session, a stop on its side, an exit later that day, and a reason", () => {
    const skips = new Set(
      createTaxonomyRepo(db)
        .listTags()
        .filter((tag) => tag.kind === "skip")
        .map((tag) => tag.id),
    );
    for (const trade of missedTrades()) {
      const levels = trade.missed;
      if (!levels || levels.stopPrice == null || trade.closedAt == null)
        throw new Error(`${trade.id} is unmarked`);
      expect(nyMinuteOfDay(trade.openedAt)).toBeGreaterThanOrEqual(9 * 60 + 30);
      expect(nyMinuteOfDay(trade.openedAt)).toBeLessThan(11 * 60);
      expect(
        levels.direction === "long"
          ? levels.stopPrice < levels.entryPrice
          : levels.stopPrice > levels.entryPrice,
      ).toBe(true);
      expect(trade.closedAt).toBeGreaterThan(trade.openedAt);
      expect(nyDate(trade.closedAt)).toBe(nyDate(trade.openedAt));
      expect(trade.tagIds.filter((id) => skips.has(id))).toHaveLength(1);
      expect(trade.scalpPrices?.holdHigh).not.toBeNull();
      const r = missedRisk(trade)?.r ?? null;
      expect(r).not.toBeNull();
      expect(r).toBeGreaterThanOrEqual(-1.2);
      expect(r).toBeLessThanOrEqual(4);
    }
  });

  it("would have won more often than not, with a few good skips", () => {
    const rs = missedTrades().map((trade) => missedRisk(trade)?.r ?? 0);
    const wins = rs.filter((r) => r > 0).length / rs.length;
    expect(wins).toBeGreaterThanOrEqual(0.5);
    expect(wins).toBeLessThanOrEqual(0.75);
    expect(rs.some((r) => r < 0)).toBe(true);
  });

  it("makes the same ones for the same seed", () => {
    const again = freshJournal();
    try {
      generateDemo(again, { end: END });
      const rOf = (journal: Db) =>
        createTradesRepo(journal)
          .list({ book: "missed" })
          .map((trade) => [trade.openedAt, missedRisk(trade)?.r]);
      expect(rOf(again)).toEqual(rOf(db));
    } finally {
      again.$client.close();
    }
  }, 120_000);
});
