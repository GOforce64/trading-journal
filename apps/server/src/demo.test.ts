import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, nyDate, nyWallClock, occSymbol } from "@tj/core";
import { createTradesRepo, type Db, openDatabase, runMigrations } from "@tj/db";
import { generateDemo } from "@tj/demo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBarService } from "./bars.js";
import { DEMO_MARKER, demoDir, parseDemoArgs, prepareDemoDir } from "./demoDir.js";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));
const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "tj-demo-server-"));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("the demo's directory", () => {
  it("is TJ_DEMO_DIR, or one in the temp directory", () => {
    expect(demoDir({ TJ_DEMO_DIR: "/x/demo" }, "/tmp")).toBe("/x/demo");
    expect(demoDir({}, "/tmp")).toBe(join("/tmp", "trading-journal-demo"));
  });

  it("is never the real data directory, nor one holding files that aren't a demo's", () => {
    const real = temp();
    expect(() => prepareDemoDir(real, real)).toThrow(/data directory/);
    const someone = temp();
    writeFileSync(join(someone, "notes.txt"), "keep me");
    expect(() => prepareDemoDir(someone, real)).toThrow(/aren't a demo's/);
    expect(readdirSync(someone)).toEqual(["notes.txt"]);
  });

  it("wipes an earlier demo and marks the new one, and makes a missing one", () => {
    const real = temp();
    const earlier = temp();
    writeFileSync(join(earlier, DEMO_MARKER), "");
    writeFileSync(join(earlier, "journal.db"), "old");
    prepareDemoDir(earlier, real);
    expect(readdirSync(earlier)).toEqual([DEMO_MARKER]);
    const missing = join(temp(), "new-demo");
    prepareDemoDir(missing, real);
    expect(existsSync(join(missing, DEMO_MARKER))).toBe(true);
    const empty = join(temp(), "empty");
    mkdirSync(empty);
    prepareDemoDir(empty, real);
    expect(readdirSync(empty)).toEqual([DEMO_MARKER]);
  });
});

describe("parseDemoArgs", () => {
  it("reads --seed and --end, and refuses an end that isn't in the past", () => {
    expect(parseDemoArgs([], "2026-12-01")).toEqual({ seed: 42, end: null });
    expect(parseDemoArgs(["--seed", "7"], "2026-12-01")).toEqual({ seed: 7, end: null });
    expect(parseDemoArgs(["--", "--end", "2026-09-30"], "2026-12-01")).toEqual({
      seed: 42,
      end: "2026-09-30",
    });
    expect(() => parseDemoArgs(["--end", "2026-12-01"], "2026-12-01")).toThrow(/before today/);
    expect(() => parseDemoArgs(["--end", "Sept 30"], "2026-12-01")).toThrow(/YYYY-MM-DD/);
    expect(() => parseDemoArgs(["--seed", "x"], "2026-12-01")).toThrow(/whole number/);
    expect(() => parseDemoArgs(["--days", "3"], "2026-12-01")).toThrow(/--days/);
  });
});

describe("the demo journal without market keys", () => {
  let db: Db;
  beforeAll(() => {
    const file = join(temp(), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
    generateDemo(db, { end: "2026-12-31", months: 1 });
  }, 30_000);
  afterAll(() => db.$client.close());

  it("draws every trade's charts from its own bars", async () => {
    const service = createBarService({ db, now: () => nyWallClock("2027-01-04", 12 * 60) });
    const trades = createTradesRepo(db).list();
    const scalps = trades.filter((trade) => trade.strategy === "scalp").slice(0, 3);
    const fly = trades.find((trade) => trade.strategy === "iron_fly");
    expect(scalps).toHaveLength(3);
    for (const trade of [...scalps, ...(fly ? [fly] : [])]) {
      const lastDay = nyDate(trade.closedAt ?? trade.openedAt);
      const from = addDays(nyDate(trade.openedAt), -7);
      const minute = await service.minute(trade.underlying, from, lastDay);
      expect(minute.unavailable).toBeNull();
      expect(minute.bars.length).toBeGreaterThan(0);
      const daily = await service.daily(trade.underlying, lastDay);
      expect(daily.unavailable).toBeNull();
      expect(daily.bars.length).toBeGreaterThan(500);
      if (trade.strategy === "scalp") {
        const [leg] = trade.legs;
        if (!leg) throw new Error("a scalp without its leg");
        const option = await service.optionMinute(
          occSymbol({ underlying: trade.underlying, ...leg }),
          from,
          lastDay,
        );
        expect(option.unavailable).toBeNull();
        expect(option.bars.length).toBeGreaterThan(0);
      }
    }
  });
});
