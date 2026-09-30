import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NewTrade } from "@tj/core";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { createIbkrRepo, type FillInput, type SyncedTradeInput } from "./ibkr.js";
import { createTaxonomyRepo } from "./taxonomy.js";
import { createTradesRepo } from "./trades.js";

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));
const ACCOUNT = { id: "acct-1", externalId: "DU1234567", kind: "paper" as const };
const OPEN = Date.UTC(2026, 8, 28, 13, 31, 5); // 09:31:05 ET
const CLOSE = Date.UTC(2026, 8, 28, 13, 46, 12);

let db: Db;
let clock = 1_000;
const ibkr = () => createIbkrRepo(db, () => clock);
const trades = () => createTradesRepo(db, () => clock);

beforeEach(() => {
  const file = join(mkdtempSync(join(tmpdir(), "tj-ibkr-")), "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  db = openDatabase(file);
  clock = 1_000;
  ibkr().ensureAccount(ACCOUNT);
});

let seq = 0;
function fillInput(overrides: Partial<FillInput> = {}): FillInput {
  seq++;
  return {
    id: `fill-${seq}`,
    brokerExecKey: `exec.${seq}`,
    brokerTradeId: `t${seq}`,
    brokerOrderId: `o${seq}`,
    conid: "924107824",
    underlying: "NVDA",
    right: "C",
    strike: 232.5,
    expiry: "2026-09-28",
    multiplier: 100,
    tradeDate: "2026-09-28",
    executedAt: OPEN,
    quantity: 1,
    price: 1.06,
    commission: 0.85,
    openClose: "O",
    kind: "trade",
    raw: {},
    ...overrides,
  };
}

/** The NVDA scalp as the grouper would hand it over. */
function scalp(overrides: Partial<NewTrade> = {}, id = "trade-nvda"): SyncedTradeInput {
  const trade: NewTrade = {
    strategy: "scalp",
    book: "paper",
    underlying: "NVDA",
    underlyingName: null,
    structureLabel: "Long call",
    openedAt: OPEN,
    closedAt: CLOSE,
    netPnl: 44.74,
    fees: 2.26,
    feesOpen: 0.93,
    feesClose: 1.33,
    notes: null,
    grade: null,
    excluded: false,
    excludeReason: null,
    source: "ibkr_flex",
    setupId: null,
    tagIds: [],
    legs: [
      {
        right: "C",
        strike: 232.5,
        expiry: "2026-09-28",
        quantity: 2,
        multiplier: 100,
        openPrice: 1.06,
        closePrice: 1.295,
      },
    ],
    ironFly: null,
    ...overrides,
  };
  return { id, trade, legIds: [`${id}-leg`] };
}

/** An AA fly: short 47 straddle, wings 40 / 54, 2 lots. */
function fly(overrides: Partial<NewTrade> = {}, id = "trade-aa"): SyncedTradeInput {
  const legs = [
    {
      right: "C" as const,
      strike: 47,
      expiry: "2026-07-17",
      quantity: -2,
      multiplier: 100,
      openPrice: 1.37,
      closePrice: 0.325,
    },
    {
      right: "P" as const,
      strike: 47,
      expiry: "2026-07-17",
      quantity: -2,
      multiplier: 100,
      openPrice: 1.49,
      closePrice: 2.14,
    },
    {
      right: "C" as const,
      strike: 54,
      expiry: "2026-07-17",
      quantity: 2,
      multiplier: 100,
      openPrice: 0.13,
      closePrice: 0,
    },
    {
      right: "P" as const,
      strike: 40,
      expiry: "2026-07-17",
      quantity: 2,
      multiplier: 100,
      openPrice: 0.08,
      closePrice: 0,
    },
  ];
  const trade: NewTrade = {
    ...scalp().trade,
    strategy: "iron_fly",
    underlying: "AA",
    structureLabel: "Short Iron Butterfly",
    openedAt: Date.UTC(2026, 6, 16, 17, 52, 42),
    closedAt: Date.UTC(2026, 6, 17, 13, 52, 10),
    netPnl: 27.32,
    fees: 9.68,
    feesOpen: 6.32,
    feesClose: 3.36,
    legs,
    ironFly: {
      bodyPutStrike: 47,
      bodyCallStrike: 47,
      putWingStrike: 40,
      callWingStrike: 54,
      contracts: 2,
      creditPerShare: 2.65,
      netCost: -520.32,
      earningsDate: null,
      earningsTiming: null,
      impliedMovePct: null,
      actualMovePct: null,
      ivBefore: null,
      ivAfter: null,
      sourceNotes: null,
    },
    ...overrides,
  };
  return { id, trade, legIds: [`${id}-47c`, `${id}-47p`, `${id}-54c`, `${id}-40p`] };
}

describe("storing fills", () => {
  it("inserts new fills, and lets Activity's version replace Today's", () => {
    const today = fillInput({ commission: 0.85 });
    expect(ibkr().storeFills(ACCOUNT.id, [today], "confirm")).toEqual({ inserted: 1, updated: 0 });
    expect(ibkr().storeFills(ACCOUNT.id, [{ ...today, commission: 0.8453 }], "activity")).toEqual({
      inserted: 0,
      updated: 1,
    });
    expect(ibkr().storeFills(ACCOUNT.id, [{ ...today, commission: 9 }], "confirm")).toEqual({
      inserted: 0,
      updated: 0,
    });
    expect(ibkr().fillsSince(ACCOUNT.id, "2026-09-28")[0]).toMatchObject({
      commission: 0.8453,
      origin: "activity",
    });
  });

  it("cancels only the fill a cancel names by trade id, size and price, not the correction booked under that id", () => {
    const original = fillInput({
      brokerExecKey: "a.01.01",
      brokerTradeId: "1786699376",
      quantity: 2,
      price: 0.73,
    });
    const correction = fillInput({
      brokerExecKey: "a.01.02",
      brokerTradeId: "1786699376",
      quantity: 1,
      price: 0.73,
    });
    ibkr().storeFills(ACCOUNT.id, [original, correction], "activity");
    const cancel = { brokerTradeId: "1786699376", quantity: 2, price: 0.73 };
    expect(ibkr().markCanceled(ACCOUNT.id, [cancel])).toBe(1);
    expect(ibkr().markCanceled(ACCOUNT.id, [cancel])).toBe(0);
    expect(
      ibkr()
        .fillsSince(ACCOUNT.id, "2026-09-28")
        .map((fill) => fill.brokerExecKey),
    ).toEqual(["a.01.02"]);
  });

  it("keeps a correction with the same size and price standing, however often the cancel is seen again", () => {
    // Every sync re-reads a year of Activity, so the same cancel arrives on every run.
    const original = fillInput({ brokerExecKey: "b.01.01", brokerTradeId: "77", quantity: 2, price: 0.73 });
    const correction = fillInput({ brokerExecKey: "b.01.02", brokerTradeId: "77", quantity: 2, price: 0.73 });
    ibkr().storeFills(ACCOUNT.id, [original, correction], "activity");
    const cancel = { brokerTradeId: "77", quantity: 2, price: 0.73 };
    expect(ibkr().markCanceled(ACCOUNT.id, [cancel])).toBe(1);
    expect(ibkr().markCanceled(ACCOUNT.id, [cancel])).toBe(0);
    expect(
      ibkr()
        .fillsSince(ACCOUNT.id, "2026-09-28")
        .map((fill) => fill.brokerExecKey),
    ).toEqual(["b.01.02"]);
  });

  it("leaves fills before the start date out of what's regrouped", () => {
    ibkr().storeFills(ACCOUNT.id, [fillInput({ tradeDate: "2026-09-25" }), fillInput()], "activity");
    expect(ibkr().fillsSince(ACCOUNT.id, "2026-09-28")).toHaveLength(1);
  });
});

describe("applying a synced trade", () => {
  it("keeps the review, the targets, the overrides and the fetched prices when it rewrites a scalp's P&L", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    const taxonomy = createTaxonomyRepo(db);
    const setup = taxonomy.createSetup({ name: "ORB breakout", strategy: "scalp" }).id;
    const calm = taxonomy.createTag({ name: "Calm", kind: "emotion" }).id;
    clock = 2_000;
    trades().update("trade-nvda", {
      setupId: setup,
      grade: "B",
      tagIds: [calm],
      notes: "clean break",
      reviewed: true,
      scalp: {
        levelBasis: "stock",
        stopPrice: 231.8,
        targets: [{ price: 234.5, contracts: 2 }],
        riskOverride: 120,
      },
    });
    trades().setScalpPrices("trade-nvda", { entryPrice: 230.83, holdHigh: 233.21, holdLow: 230.71 }, 3_000);
    clock = 5_000;
    expect(ibkr().apply(scalp({ netPnl: 40.1 }), ACCOUNT.id)).toBe("updated");
    const stored = trades().get("trade-nvda");
    expect(stored).toMatchObject({
      netPnl: 40.1,
      setupId: setup,
      grade: "B",
      tagIds: [calm],
      notes: "clean break",
      reviewedAt: 2_000,
      scalpPrices: { entryPrice: 230.83, holdHigh: 233.21 },
    });
    expect(stored?.scalp).toMatchObject({
      levelBasis: "stock",
      stopPrice: 231.8,
      targets: [{ price: 234.5, contracts: 2 }],
      riskOverride: 120,
    });
  });

  it("drops a scalp's fetched prices when a sync closes it, so the range is fetched too", () => {
    ibkr().apply(scalp({ closedAt: null, netPnl: null }), ACCOUNT.id);
    trades().setScalpPrices("trade-nvda", { entryPrice: 230.83, holdHigh: null, holdLow: null }, 3_000);
    expect(ibkr().apply(scalp(), ACCOUNT.id)).toBe("updated");
    expect(trades().get("trade-nvda")?.scalpPrices).toBeNull();
  });

  it("adds a new trade as the sync's, with its leg ids", () => {
    expect(ibkr().apply(scalp(), ACCOUNT.id)).toBe("added");
    const stored = trades().get("trade-nvda");
    expect(stored).toMatchObject({
      source: "ibkr_flex",
      accountId: ACCOUNT.id,
      editedAt: null,
      netPnl: 44.74,
    });
    expect(stored?.legs.map((leg) => leg.id)).toEqual(["trade-nvda-leg"]);
  });

  it("leaves an unchanged trade alone, updatedAt included", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    clock = 5_000;
    expect(ibkr().apply(scalp(), ACCOUNT.id)).toBe("unchanged");
    expect(trades().get("trade-nvda")?.updatedAt).toBe(1_000);
  });

  it("rewrites only its own side, keeping the user's notes and a fly's overrides", () => {
    ibkr().apply(fly(), ACCOUNT.id);
    trades().update("trade-aa", {
      notes: "earnings pop",
      ironFly: { ...(fly().trade.ironFly as NonNullable<NewTrade["ironFly"]>), impliedMovePct: 7.1 },
    });
    clock = 5_000;
    expect(ibkr().apply(fly({ netPnl: 27.5, fees: 9.5 }), ACCOUNT.id)).toBe("updated");
    const stored = trades().get("trade-aa");
    expect(stored).toMatchObject({ netPnl: 27.5, notes: "earnings pop", updatedAt: 5_000 });
    expect(stored?.ironFly?.impliedMovePct).toBe(7.1);
  });

  it("clears a stock price the new close time made stale", () => {
    ibkr().apply(fly(), ACCOUNT.id);
    trades().setUnderlyingPrice("trade-aa", "exit", 46.1);
    ibkr().apply(fly({ closedAt: Date.UTC(2026, 6, 17, 14, 30) }), ACCOUNT.id);
    expect(trades().get("trade-aa")?.ironFly?.underlyingPriceExit).toBeNull();
  });

  it("never brings back a trade the user deleted", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    trades().softDelete("trade-nvda");
    expect(ibkr().apply(scalp(), ACCOUNT.id)).toBe("deleted");
    expect(trades().get("trade-nvda")).toBeNull();
  });

  it("keeps a trade whose facts the user edited, saying so when IBKR differs", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    trades().update("trade-nvda", { netPnl: 50 });
    expect(ibkr().apply(scalp(), ACCOUNT.id)).toBe("kept_edits");
    expect(trades().get("trade-nvda")?.netPnl).toBe(50);
    expect(ibkr().apply(scalp({ netPnl: 50 }), ACCOUNT.id)).toBe("unchanged");
  });
});

describe("the duplicate guards", () => {
  const typedFly = (openedAt: number) =>
    trades().create({ ...fly().trade, source: "oquants_extract", openedAt, closedAt: openedAt + 86_400_000 });

  it("finds a fly already imported from oQuants: same ticker, body, expiry and New York day", () => {
    typedFly(Date.UTC(2026, 6, 16, 17, 54));
    expect(ibkr().isDuplicate(fly())).toBe(true);
  });

  it("doesn't match another day, or a trade the sync made itself", () => {
    typedFly(Date.UTC(2026, 6, 15, 17, 54));
    expect(ibkr().isDuplicate(fly())).toBe(false);
    ibkr().apply(fly({}, "synced-aa"), ACCOUNT.id);
    expect(ibkr().isDuplicate(fly())).toBe(false);
  });

  it("tells the oQuants import when a fly was already synced from IBKR", () => {
    ibkr().apply(fly(), ACCOUNT.id);
    const fromOquants = {
      ...fly().trade,
      source: "oquants_extract" as const,
      openedAt: Date.UTC(2026, 6, 16, 17, 54),
    };
    expect(ibkr().syncedFrom(fromOquants)).toBe(true);
    expect(ibkr().syncedFrom({ ...fromOquants, underlying: "AAL" })).toBe(false);
  });

  it("finds a scalp typed by hand on the same contract and day", () => {
    trades().create({ ...scalp().trade, source: "manual", openedAt: OPEN + 3_600_000 });
    expect(ibkr().isDuplicate(scalp())).toBe(true);
  });
});

describe("orphans, links and runs", () => {
  it("soft-deletes a synced trade no group produced, but never one the user edited or one from before the start date", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    ibkr().apply(scalp({ underlying: "TSLA" }, "trade-tsla"), ACCOUNT.id);
    trades().update("trade-tsla", { netPnl: 1 });
    ibkr().apply(fly(), ACCOUNT.id);
    expect(ibkr().softDeleteOrphans(ACCOUNT.id, new Set(), "2026-09-28")).toBe(1);
    expect(trades().get("trade-nvda")).toBeNull();
    expect(trades().get("trade-tsla")).not.toBeNull();
    expect(trades().get("trade-aa")).not.toBeNull();
  });

  it("links fills to their trade and leg, and unlinks the rest", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    const linked = fillInput();
    const stray = fillInput();
    ibkr().storeFills(ACCOUNT.id, [linked, stray], "confirm");
    ibkr().linkFills(ACCOUNT.id, new Map([[linked.id, { tradeId: "trade-nvda", legId: "trade-nvda-leg" }]]));
    expect(
      ibkr()
        .fillsForTrade("trade-nvda")
        .map((fill) => fill.id),
    ).toEqual([linked.id]);
    ibkr().linkFills(ACCOUNT.id, new Map());
    expect(ibkr().fillsForTrade("trade-nvda")).toEqual([]);
  });

  it("records the last run, errors before any account included", () => {
    expect(ibkr().lastRun()).toBeNull();
    ibkr().recordRun({
      at: 2_000,
      status: "error",
      error: "IBKR rejected the token.",
      summary: { added: 0 },
      accountId: null,
    });
    expect(ibkr().lastRun()).toEqual({
      accountId: null,
      lastRunAt: 2_000,
      lastStatus: "error",
      lastError: "IBKR rejected the token.",
      lastSummary: { added: 0 },
    });
    ibkr().recordRun({ at: 3_000, status: "ok", error: null, summary: { added: 2 }, accountId: ACCOUNT.id });
    expect(ibkr().lastRun()).toMatchObject({
      accountId: ACCOUNT.id,
      lastStatus: "ok",
      lastSummary: { added: 2 },
    });
  });

  it("knows which trades exist, deleted ones included", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    trades().softDelete("trade-nvda");
    expect(ibkr().tradeExists("trade-nvda")).toBe(true);
    expect(ibkr().tradeExists("nope")).toBe(false);
  });
});
