import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NewTrade } from "@tj/core";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { createTradesRepo } from "./trades.js";

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

/** Sample broken-wing fly: short 50 straddle, wings 45 / 58, 4 lots. */
const sampleFly: NewTrade = {
  strategy: "iron_fly",
  book: "live",
  underlying: "XYZ",
  underlyingName: "XYZ Industries",
  structureLabel: "Short Iron Butterfly",
  openedAt: 1788_000_000_000,
  closedAt: 1788_086_400_000,
  netPnl: 512,
  fees: 8,
  notes: null,
  grade: null,
  excluded: false,
  excludeReason: null,
  source: "manual",
  setupId: null,
  tagIds: [],
  legs: [
    {
      right: "C",
      strike: 50,
      expiry: "2026-10-16",
      quantity: -4,
      multiplier: 100,
      openPrice: 2.1,
      closePrice: 1,
    },
    {
      right: "P",
      strike: 50,
      expiry: "2026-10-16",
      quantity: -4,
      multiplier: 100,
      openPrice: 1.6,
      closePrice: 0.8,
    },
  ],
  ironFly: {
    bodyPutStrike: 50,
    bodyCallStrike: 50,
    putWingStrike: 45,
    callWingStrike: 58,
    contracts: 4,
    creditPerShare: 3,
    netCost: -1192,
    earningsDate: "2026-10-15",
    earningsTiming: "AMC",
    impliedMovePct: null,
    actualMovePct: null,
    ivBefore: null,
    ivAfter: null,
    sourceNotes: "sample row",
  },
};

describe("trades repository", () => {
  let db: Db;
  let clock = 1_000;
  const repo = () => createTradesRepo(db, () => clock);

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-repo-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
    clock = 1_000;
  });

  it("stores a trade with its legs and iron fly details", () => {
    const created = repo().create({ ...sampleFly });
    const found = repo().get(created.id);
    expect(found?.underlying).toBe("XYZ");
    expect(found?.legs).toHaveLength(2);
    expect(found?.ironFly?.callWingStrike).toBe(58);
    expect(found?.editedAt).toBe(1_000);
  });

  it("leaves editedAt null for trades written by an importer", () => {
    const created = repo().create({ ...sampleFly, source: "oquants_extract" });
    expect(repo().get(created.id)?.editedAt).toBeNull();
  });

  it("filters by strategy and book, newest first", () => {
    const trades = repo();
    trades.create({ ...sampleFly, openedAt: 1000 });
    trades.create({ ...sampleFly, openedAt: 5000, book: "paper" });
    expect(trades.list({ book: "live" })).toHaveLength(1);
    expect(trades.list({ strategy: "scalp" })).toHaveLength(0);
    expect(trades.list()[0]?.openedAt).toBe(5000);
  });

  it("hides excluded trades unless asked for them", () => {
    const trades = repo();
    trades.create({ ...sampleFly, excluded: true, excludeReason: "test trade" });
    expect(trades.list()).toHaveLength(0);
    expect(trades.list({ includeExcluded: true })).toHaveLength(1);
  });

  it("updates a patch and bumps editedAt", () => {
    const trades = repo();
    const created = trades.create({ ...sampleFly });
    clock = 2_000;
    const updated = trades.update(created.id, { grade: "B", notes: "crush paid" });
    expect(updated?.grade).toBe("B");
    expect(updated?.notes).toBe("crush paid");
    expect(updated?.editedAt).toBe(2_000);
  });

  it("leaves untouched fields alone when patching one field", () => {
    const trades = repo();
    const created = trades.create({ ...sampleFly });
    const updated = trades.update(created.id, { grade: "A" });
    expect(updated?.legs).toHaveLength(2);
    expect(updated?.ironFly?.contracts).toBe(4);
    expect(updated?.netPnl).toBe(512);
  });

  it("replaces legs wholesale when a patch includes them", () => {
    const trades = repo();
    const created = trades.create({ ...sampleFly });
    const updated = trades.update(created.id, {
      legs: [
        {
          right: "C",
          strike: 61,
          expiry: "2026-10-16",
          quantity: 1,
          multiplier: 100,
          openPrice: 0.05,
          closePrice: null,
        },
      ],
    });
    expect(updated?.legs).toHaveLength(1);
    expect(updated?.legs[0]?.strike).toBe(61);
  });

  it("soft deletes, hiding the trade from list but keeping the row", () => {
    const trades = repo();
    const created = trades.create({ ...sampleFly });
    expect(trades.softDelete(created.id)).toBe(true);
    expect(trades.list()).toHaveLength(0);
    expect(trades.get(created.id)).toBeNull();
    expect(trades.softDelete(created.id)).toBe(false);
  });

  it("returns null when updating a trade that does not exist", () => {
    expect(repo().update(crypto.randomUUID(), { grade: "A" })).toBeNull();
  });
});
