import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PriceBar } from "@tj/core";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { createBarsRepo } from "./bars.js";

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));
const bar = (t: number, c: number): PriceBar => ({ t, o: c, h: c, l: c, c, v: 100 });
const FRI = Date.UTC(2026, 8, 25, 13, 30); // Fri Sep 25, 09:30 ET
const MON = Date.UTC(2026, 8, 28, 13, 30); // Mon Sep 28, 09:30 ET

let db: Db;
beforeEach(() => {
  const file = join(mkdtempSync(join(tmpdir(), "tj-bars-")), "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  db = openDatabase(file);
});

describe("the bar cache", () => {
  it("stores finished days with their bars, remembers empty ones, and reads a range oldest first", () => {
    const repo = createBarsRepo(db);
    repo.store(
      "NVDA",
      "1m",
      [
        { date: "2026-09-28", bars: [bar(MON + 60_000, 229.8), bar(MON, 229.5)] },
        { date: "2026-09-26", bars: [] },
        { date: "2026-09-25", bars: [bar(FRI, 228)] },
      ],
      1_000,
    );
    expect(repo.knownDays("NVDA", "1m", ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"])).toEqual(
      new Set(["2026-09-25", "2026-09-26", "2026-09-28"]),
    );
    expect(repo.read("NVDA", "1m", FRI, MON + 60_000).map((each) => each.c)).toEqual([228, 229.5, 229.8]);
    expect(repo.read("NVDA", "1m", MON, MON)).toEqual([bar(MON, 229.5)]);
  });

  it("keeps a day as first stored, and keeps symbols and timeframes apart", () => {
    const repo = createBarsRepo(db);
    repo.store("NVDA", "1m", [{ date: "2026-09-28", bars: [bar(MON, 229.5)] }], 1_000);
    repo.store("NVDA", "1m", [{ date: "2026-09-28", bars: [bar(MON, 1)] }], 2_000);
    expect(repo.read("NVDA", "1m", MON, MON).map((each) => each.c)).toEqual([229.5]);
    expect(repo.knownDays("TSLA", "1m", ["2026-09-28"]).size).toBe(0);
    expect(repo.knownDays("NVDA", "1d", ["2026-09-28"]).size).toBe(0);
    expect(repo.knownDays("NVDA", "1m", []).size).toBe(0);
  });
});
