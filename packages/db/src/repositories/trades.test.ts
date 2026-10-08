import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IronFlyDetailsInput, NewTrade } from "@tj/core";
import { nyWallClock } from "@tj/core";
import { asc } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { scalpTargets } from "../schema.js";
import { createTaxonomyRepo } from "./taxonomy.js";
import { createTradesRepo, ReviewRuleError, staleOptionRange } from "./trades.js";

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
  feesOpen: 5,
  feesClose: 3,
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
  missed: null,
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

  it("breaks a tie in open time by id, so the review queue's order never shuffles", () => {
    const trades = repo();
    const ids = Array.from({ length: 6 }, () => trades.create({ ...sampleFly, openedAt: 3000 }).id);
    expect(trades.list().map((trade) => trade.id)).toEqual([...ids].sort().reverse());
  });

  it("reads a list's legs, details, levels, prices and tags a table at a time, not trade by trade", () => {
    const trades = repo();
    for (let index = 0; index < 20; index++) trades.create({ ...sampleFly, openedAt: 1000 + index });
    // Drizzle keeps the better-sqlite3 handle on $client; every query prepares a statement there.
    const client = (db as unknown as { $client: { prepare(sql: string): unknown } }).$client;
    const prepare = vi.spyOn(client, "prepare");
    const listed = trades.list();
    expect(listed).toHaveLength(20);
    expect(listed.every((trade) => trade.legs.length === 2 && trade.ironFly != null)).toBe(true);
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(8);
    prepare.mockRestore();
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

  // 501 separate write transactions to a file-backed database: about 3 s on CI's Windows runner, and more while
  // other test files write too, so the default 5 s is too tight there.
  it("lists 500 trades by default, and every trade when the limit is null", { timeout: 20_000 }, () => {
    const trades = repo();
    for (let index = 0; index < 501; index++) trades.create({ ...sampleFly, openedAt: 1000 + index });
    expect(trades.list()).toHaveLength(500);
    expect(trades.list({ limit: null })).toHaveLength(501);
  });
});

describe("importing", () => {
  let repo: ReturnType<typeof createTradesRepo>;

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-import-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    repo = createTradesRepo(openDatabase(file), () => 1_790_000_000_000);
  });

  const imported: NewTrade = { ...sampleFly, source: "oquants_extract", book: "paper" };
  const ID_A = "0b0e0a2e-5b1c-5d8f-9a53-8a0f0f0f0f01";
  const ID_B = "0b0e0a2e-5b1c-5d8f-9a53-8a0f0f0f0f02";

  it("inserts under the given ids, tagged with the batch and not marked as user-edited", () => {
    expect(repo.importMany([{ id: ID_A, trade: imported }], "batch-1")).toBe(1);
    const stored = repo.get(ID_A);
    expect(stored?.importBatchId).toBe("batch-1");
    expect(stored?.source).toBe("oquants_extract");
    expect(stored?.editedAt).toBeNull();
    expect(stored?.legs).toHaveLength(imported.legs.length);
    expect(stored?.ironFly?.putWingStrike).toBe(45);
  });

  it("reports which ids exist, soft-deleted ones included", () => {
    repo.importMany([{ id: ID_A, trade: imported }], "batch-1");
    repo.softDelete(ID_A);
    expect(repo.existingIds([ID_A, ID_B])).toEqual(new Set([ID_A]));
  });

  it("writes nothing when any trade in the batch fails", () => {
    expect(() =>
      repo.importMany(
        [
          { id: ID_A, trade: imported },
          { id: ID_A, trade: imported },
        ],
        "batch-1",
      ),
    ).toThrow();
    expect(repo.existingIds([ID_A]).size).toBe(0);
  });
});

describe("stock prices for the move data", () => {
  const OPEN = Date.UTC(2026, 8, 9, 19, 54); // Wed Sep 9, 15:54 ET
  const CLOSE = Date.UTC(2026, 8, 10, 19, 44); // Thu Sep 10, 15:44 ET
  const DAY = 86_400_000;
  const details = sampleFly.ironFly as IronFlyDetailsInput;
  let db: Db;
  let clock = 1_000;
  const repo = () => createTradesRepo(db, () => clock);

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-repo-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
    clock = 1_000;
  });

  /** A closed fly inside market hours, with both prices stored. */
  function priced(overrides: Partial<NewTrade> = {}): string {
    const id = repo().create({ ...sampleFly, openedAt: OPEN, closedAt: CLOSE, ...overrides }).id;
    repo().setUnderlyingPrice(id, "entry", 21.66);
    repo().setUnderlyingPrice(id, "exit", 20.505);
    return id;
  }

  const prices = (id: string) => {
    const fly = repo().get(id)?.ironFly;
    return [fly?.underlyingPriceEntry, fly?.underlyingPriceExit];
  };

  it("stores a price only where none is stored yet", () => {
    const id = repo().create({ ...sampleFly, openedAt: OPEN, closedAt: CLOSE }).id;
    expect(repo().setUnderlyingPrice(id, "entry", 21.66)).toBe(true);
    expect(repo().setUnderlyingPrice(id, "entry", 99)).toBe(false);
    expect(prices(id)).toEqual([21.66, null]);
  });

  it("doesn't count a fill as a user edit", () => {
    const id = repo().create({ ...sampleFly, source: "oquants_extract" }).id;
    clock = 2_000;
    repo().setUnderlyingPrice(id, "entry", 21.66);
    expect(repo().get(id)).toMatchObject({ updatedAt: 1_000, editedAt: null });
  });

  it("keeps the prices, the source notes and the typed moves through an edit of the fly details", () => {
    const id = priced();
    repo().update(id, { ironFly: { ...details, impliedMovePct: 7.3, ivBefore: 120 } });
    expect(repo().get(id)?.ironFly).toMatchObject({
      underlyingPriceEntry: 21.66,
      underlyingPriceExit: 20.505,
      impliedMovePct: 7.3,
      ivBefore: 120,
      sourceNotes: "sample row",
    });
  });

  it("still removes the fly details when a patch sets them to null", () => {
    const id = priced();
    repo().update(id, { strategy: "scalp", ironFly: null });
    expect(repo().get(id)?.ironFly).toBeNull();
  });

  it("clears the entry price when the open moves to another minute, and the exit price for the close", () => {
    const id = priced();
    repo().update(id, { openedAt: OPEN + 60_000 });
    expect(prices(id)).toEqual([null, 20.505]);
    repo().setUnderlyingPrice(id, "entry", 21.7);
    repo().update(id, { closedAt: CLOSE + 3_600_000 });
    expect(prices(id)).toEqual([21.7, null]);
  });

  it("keeps the prices when an edit only drops the seconds from the times", () => {
    const id = priced({ openedAt: OPEN + 37_000, closedAt: CLOSE + 12_000 });
    repo().update(id, { openedAt: OPEN, closedAt: CLOSE, notes: "edited" });
    expect(prices(id)).toEqual([21.66, 20.505]);
  });

  it("clears both prices when the ticker changes", () => {
    const id = priced();
    repo().update(id, { underlying: "ABC" });
    expect(prices(id)).toEqual([null, null]);
  });

  it("clears the exit price when the trade is reopened", () => {
    const id = priced();
    repo().update(id, { closedAt: null, netPnl: null });
    expect(prices(id)).toEqual([21.66, null]);
  });

  it("lists the flies missing a price they can have, oldest first, excluded ones included", () => {
    const open = repo().create({ ...sampleFly, openedAt: OPEN - DAY, closedAt: null }).id;
    const halfDone = repo().create({ ...sampleFly, openedAt: OPEN, closedAt: CLOSE, excluded: true }).id;
    repo().setUnderlyingPrice(halfDone, "entry", 21.66);
    priced({ openedAt: OPEN + DAY, closedAt: CLOSE + DAY });
    const deleted = repo().create({ ...sampleFly, openedAt: OPEN }).id;
    repo().softDelete(deleted);
    repo().create({ ...sampleFly, strategy: "scalp", ironFly: null });

    expect(repo().missingPrices()).toEqual([
      {
        tradeId: open,
        underlying: "XYZ",
        openedAt: OPEN - DAY,
        closedAt: null,
        missingEntry: true,
        missingExit: false,
      },
      {
        tradeId: halfDone,
        underlying: "XYZ",
        openedAt: OPEN,
        closedAt: CLOSE,
        missingEntry: false,
        missingExit: true,
      },
    ]);
  });

  it("narrows to the ids asked for, and to none for an empty list", () => {
    const first = repo().create({ ...sampleFly, openedAt: OPEN }).id;
    repo().create({ ...sampleFly, openedAt: OPEN + DAY });
    expect(
      repo()
        .missingPrices([first])
        .map((gap) => gap.tradeId),
    ).toEqual([first]);
    expect(repo().missingPrices([])).toEqual([]);
  });
});

describe("facts the user edited", () => {
  // As a sync stores them: to the second.
  const OPEN = Date.UTC(2026, 8, 9, 19, 54, 37);
  const CLOSE = Date.UTC(2026, 8, 10, 19, 44, 12);
  const minute = (at: number) => Math.floor(at / 60_000) * 60_000;
  const details = sampleFly.ironFly as IronFlyDetailsInput;
  let db: Db;
  let clock = 1_000;
  const repo = () => createTradesRepo(db, () => clock);

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-repo-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
    clock = 1_000;
  });

  const created = () => repo().create({ ...sampleFly, openedAt: OPEN, closedAt: CLOSE }).id;
  const factsEditedAt = (id: string) => repo().get(id)?.factsEditedAt;

  it("marks a trade whose leg the user changed", () => {
    const id = created();
    clock = 2_000;
    const legs = (sampleFly.legs ?? []).map((leg, index) =>
      index === 0 ? { ...leg, closePrice: 0.9 } : leg,
    );
    repo().update(id, { legs });
    expect(factsEditedAt(id)).toBe(2_000);
  });

  it("doesn't mark it for notes, exclude or a move override", () => {
    const id = created();
    repo().update(id, { notes: "held too long", excluded: true });
    repo().update(id, { ironFly: { ...details, impliedMovePct: 7.3 } });
    expect(factsEditedAt(id)).toBeNull();
  });

  it("doesn't mark it for a form save that sends the same facts back, with the seconds dropped", () => {
    const id = created();
    const stored = repo().get(id);
    if (!stored) throw new Error("missing");
    repo().update(id, {
      strategy: "iron_fly",
      book: stored.book as "live",
      underlying: stored.underlying,
      structureLabel: stored.structureLabel,
      openedAt: minute(OPEN),
      closedAt: minute(CLOSE),
      netPnl: stored.netPnl,
      fees: stored.fees,
      feesOpen: stored.feesOpen,
      feesClose: stored.feesClose,
      // The form sends every leg, in its own order.
      legs: [...stored.legs].reverse().map((leg) => ({
        right: leg.right as "C" | "P",
        strike: leg.strike,
        expiry: leg.expiry,
        quantity: leg.quantity,
        multiplier: leg.multiplier,
        openPrice: leg.openPrice,
        closePrice: leg.closePrice,
      })),
      ironFly: { ...details, impliedMovePct: 6.8 },
    });
    expect(factsEditedAt(id)).toBeNull();
  });

  it("marks it when a time moves to another minute, or the P&L changes", () => {
    const first = created();
    repo().update(first, { closedAt: CLOSE + 60_000 });
    expect(factsEditedAt(first)).toBeTypeOf("number");
    const second = created();
    repo().update(second, { netPnl: 400 });
    expect(factsEditedAt(second)).toBeTypeOf("number");
  });

  it("clears the mark on an IBKR trade, and refuses any other", () => {
    const id = repo().create({ ...sampleFly, source: "ibkr_flex" }).id;
    repo().update(id, { netPnl: 400 });
    expect(repo().clearFactsEdited(id)).toBe(true);
    expect(factsEditedAt(id)).toBeNull();
    const typed = created();
    expect(repo().clearFactsEdited(typed)).toBe(false);
  });
});

describe("the scalp review", () => {
  /** The Sep 28 NVDA 232.5C scalp, closed. */
  const nvda: NewTrade = {
    ...sampleFly,
    strategy: "scalp",
    book: "paper",
    underlying: "NVDA",
    underlyingName: null,
    structureLabel: "Long call",
    netPnl: 44.74,
    fees: 2.26,
    feesOpen: 0.93,
    feesClose: 1.33,
    notes: null,
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
  };
  let db: Db;
  let clock = 1_000;
  const repo = () => createTradesRepo(db, () => clock);

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-repo-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
    clock = 1_000;
  });

  it("stores a scalp's first level with its basis, to the cent", () => {
    const id = repo().create(nvda).id;
    expect(repo().get(id)?.scalp).toBeNull();
    repo().update(id, { scalp: { levelBasis: "stock", stopPrice: 231.804 } });
    expect(repo().get(id)?.scalp).toEqual({
      tradeId: id,
      levelBasis: "stock",
      stopPrice: 231.8,
      stockEntryOverride: null,
      riskOverride: null,
      targets: [],
    });
  });

  it("merges a partial patch, keeping the other levels", () => {
    const id = repo().create(nvda).id;
    repo().update(id, { scalp: { levelBasis: "stock", stopPrice: 231.8 } });
    repo().update(id, { scalp: { targets: [{ price: 234.5, contracts: 2 }] } });
    expect(repo().get(id)?.scalp).toMatchObject({
      stopPrice: 231.8,
      targets: [{ price: 234.5, contracts: 2 }],
    });
    repo().update(id, { scalp: { stopPrice: null } });
    expect(repo().get(id)?.scalp).toMatchObject({
      stopPrice: null,
      targets: [{ price: 234.5, contracts: 2 }],
    });
  });

  it("needs a basis for the first level, and writes nothing without one", () => {
    const id = repo().create(nvda).id;
    expect(() => repo().update(id, { scalp: { stopPrice: 231.8 }, grade: "A" })).toThrow(ReviewRuleError);
    expect(repo().get(id)).toMatchObject({ scalp: null, grade: null });
  });

  it("clears the stop and targets when the basis changes, unless the patch sets them, and keeps the overrides", () => {
    const id = repo().create(nvda).id;
    repo().update(id, {
      scalp: {
        levelBasis: "stock",
        stopPrice: 231.8,
        targets: [{ price: 234.5, contracts: 1 }],
        stockEntryOverride: 230.83,
      },
    });
    repo().update(id, { scalp: { levelBasis: "premium" } });
    expect(repo().get(id)?.scalp).toMatchObject({
      levelBasis: "premium",
      stopPrice: null,
      targets: [],
      stockEntryOverride: 230.83,
    });
    repo().update(id, { scalp: { levelBasis: "stock", stopPrice: 231 } });
    expect(repo().get(id)?.scalp).toMatchObject({ levelBasis: "stock", stopPrice: 231, targets: [] });
  });

  it("refuses 0 on the stock basis, and takes it on premium", () => {
    const id = repo().create(nvda).id;
    expect(() => repo().update(id, { scalp: { levelBasis: "stock", stopPrice: 0 } })).toThrow(
      "A stock price must be above 0",
    );
    repo().update(id, { scalp: { levelBasis: "premium", stopPrice: 0 } });
    expect(repo().get(id)?.scalp?.stopPrice).toBe(0);
  });

  it("gives only a scalp a stop and target", () => {
    const id = repo().create(sampleFly).id;
    expect(() => repo().update(id, { scalp: { levelBasis: "stock", stopPrice: 50 } })).toThrow(
      "Only a scalp has a stop and target",
    );
  });

  it("stamps Done reviewing with the clock and clears it, as a review edit and not a fact edit", () => {
    const id = repo().create({ ...nvda, source: "ibkr_flex" }).id;
    clock = 2_000;
    const done = repo().update(id, { reviewed: true, scalp: { levelBasis: "stock", stopPrice: 231.8 } });
    expect(done).toMatchObject({ reviewedAt: 2_000, editedAt: 2_000, factsEditedAt: null });
    expect(repo().update(id, { reviewed: false })?.reviewedAt).toBeNull();
  });

  it("allows one emotion at most, with any number of mistakes", () => {
    const taxonomy = createTaxonomyRepo(db);
    const calm = taxonomy.createTag({ name: "Calm", kind: "emotion" }).id;
    const rushed = taxonomy.createTag({ name: "Rushed", kind: "emotion" }).id;
    const fomo = taxonomy.createTag({ name: "FOMO entry", kind: "mistake" }).id;
    const early = taxonomy.createTag({ name: "Exited early", kind: "mistake" }).id;
    const id = repo().create(nvda).id;
    const both = [calm, fomo, early].sort();
    expect(
      repo()
        .update(id, { tagIds: [calm, fomo, early] })
        ?.tagIds.sort(),
    ).toEqual(both);
    expect(() => repo().update(id, { tagIds: [calm, rushed] })).toThrow("A trade has at most one emotion");
    expect(repo().get(id)?.tagIds.sort()).toEqual(both);
  });

  it("keeps targets in the order the trade reaches them, numbered from 1 on every save", () => {
    const id = repo().create(nvda).id;
    repo().update(id, {
      scalp: {
        levelBasis: "stock",
        targets: [
          { price: 234.5, contracts: 1 },
          { price: 233, contracts: 1 },
        ],
      },
    });
    expect(repo().get(id)?.scalp?.targets).toEqual([
      { price: 233, contracts: 1 },
      { price: 234.5, contracts: 1 },
    ]);
    const rows = () =>
      db
        .select({ position: scalpTargets.position, price: scalpTargets.price })
        .from(scalpTargets)
        .orderBy(asc(scalpTargets.position))
        .all();
    expect(rows()).toEqual([
      { position: 1, price: 233 },
      { position: 2, price: 234.5 },
    ]);
    repo().update(id, { scalp: { targets: [{ price: 240, contracts: 2 }] } });
    expect(rows()).toEqual([{ position: 1, price: 240 }]);
    repo().update(id, { scalp: { targets: [] } });
    expect(rows()).toEqual([]);

    const put = repo().create({
      ...nvda,
      legs: [
        {
          right: "P",
          strike: 229,
          expiry: "2026-09-28",
          quantity: 2,
          multiplier: 100,
          openPrice: 1.06,
          closePrice: 1.295,
        },
      ],
    }).id;
    repo().update(put, {
      scalp: {
        levelBasis: "stock",
        targets: [
          { price: 228, contracts: 1 },
          { price: 229.5, contracts: 1 },
        ],
      },
    });
    expect(
      repo()
        .get(put)
        ?.scalp?.targets.map((target) => target.price),
    ).toEqual([229.5, 228]);
    repo().update(put, {
      scalp: {
        levelBasis: "premium",
        targets: [
          { price: 2.5, contracts: 1 },
          { price: 1.8, contracts: 1 },
        ],
      },
    });
    expect(
      repo()
        .get(put)
        ?.scalp?.targets.map((target) => target.price),
    ).toEqual([1.8, 2.5]);
  });

  it("refuses targets that trim more than the position, or a stock target at 0, keeping the list", () => {
    const id = repo().create(nvda).id;
    repo().update(id, { scalp: { levelBasis: "stock", targets: [{ price: 233, contracts: 2 }] } });
    expect(() =>
      repo().update(id, {
        scalp: {
          targets: [
            { price: 233, contracts: 2 },
            { price: 234.5, contracts: 1 },
          ],
        },
      }),
    ).toThrow("The targets trim 3 contracts; the position has 2.");
    expect(() => repo().update(id, { scalp: { targets: [{ price: 0, contracts: 1 }] } })).toThrow(
      "A stock price must be above 0",
    );
    expect(repo().get(id)?.scalp?.targets).toEqual([{ price: 233, contracts: 2 }]);
  });

  it("still saves a stop after a size edit left the saved targets trimming too much", () => {
    const id = repo().create(nvda).id;
    repo().update(id, { scalp: { levelBasis: "stock", targets: [{ price: 233, contracts: 2 }] } });
    repo().update(id, {
      legs: [
        {
          right: "C",
          strike: 232.5,
          expiry: "2026-09-28",
          quantity: 1,
          multiplier: 100,
          openPrice: 1.06,
          closePrice: 1.295,
        },
      ],
    });
    repo().update(id, { scalp: { stopPrice: 229, riskOverride: 60 } });
    expect(repo().get(id)?.scalp).toMatchObject({
      stopPrice: 229,
      riskOverride: 60,
      targets: [{ price: 233, contracts: 2 }],
    });
    expect(() => repo().update(id, { scalp: { targets: [{ price: 233, contracts: 2 }] } })).toThrow(
      "The targets trim 2 contracts; the position has 1.",
    );
  });

  it("stores the typed overrides to the cent, clears them with null, and refuses 0 or less", () => {
    const id = repo().create(nvda).id;
    repo().update(id, { scalp: { levelBasis: "stock", stockEntryOverride: 230.834, riskOverride: 120 } });
    expect(repo().get(id)?.scalp).toMatchObject({ stockEntryOverride: 230.83, riskOverride: 120 });
    repo().update(id, { scalp: { riskOverride: null } });
    expect(repo().get(id)?.scalp).toMatchObject({ stockEntryOverride: 230.83, riskOverride: null });
    expect(() => repo().update(id, { scalp: { stockEntryOverride: 0 } })).toThrow(
      "A stock price must be above 0",
    );
    expect(() => repo().update(id, { scalp: { riskOverride: -5 } })).toThrow(
      "A planned risk must be above 0",
    );
  });

  it("judges a value at the cent it's stored at, so 0.004 is refused as the 0 it would become", () => {
    const id = repo().create(nvda).id;
    expect(() => repo().update(id, { scalp: { levelBasis: "stock", stockEntryOverride: 0.004 } })).toThrow(
      "A stock price must be above 0",
    );
    expect(() => repo().update(id, { scalp: { levelBasis: "stock", riskOverride: 0.004 } })).toThrow(
      "A planned risk must be above 0",
    );
    expect(() => repo().update(id, { scalp: { levelBasis: "stock", stopPrice: 0.004 } })).toThrow(
      "A stock price must be above 0",
    );
    expect(repo().get(id)?.scalp).toBeNull();
  });

  it("lists scalps missing a fetched price, oldest first, and stores what the filler finds without an edit", () => {
    const closed = repo().create(nvda).id;
    const open = repo().create({
      ...nvda,
      openedAt: nvda.openedAt + 60_000,
      closedAt: null,
      netPnl: null,
    }).id;
    repo().create(sampleFly);
    const gaps = () =>
      repo()
        .missingScalpPrices()
        .map((gap) => gap.tradeId);
    expect(gaps()).toEqual([closed, open]);
    expect(repo().missingScalpPrices([open])).toEqual([
      {
        tradeId: open,
        underlying: "NVDA",
        openedAt: nvda.openedAt + 60_000,
        closedAt: null,
        entryPrice: null,
        holdHigh: null,
        optionHigh: null,
      },
    ]);
    expect(repo().missingScalpPrices([])).toEqual([]);

    clock = 2_000;
    repo().setScalpPrices(open, { entryPrice: 230.83, holdHigh: null, holdLow: null }, 2_000);
    repo().setScalpPrices(closed, { entryPrice: 230.83, holdHigh: null, holdLow: null }, 2_000);
    // A closed scalp waits for its range; an open one has what it can have.
    expect(gaps()).toEqual([closed]);
    repo().setScalpPrices(closed, { entryPrice: null, holdHigh: 233.21, holdLow: 230.71 }, 3_000);
    // And for the option's range.
    expect(gaps()).toEqual([closed]);
    repo().setScalpPrices(
      closed,
      { entryPrice: null, holdHigh: null, holdLow: null, optionHigh: 1.37, optionLow: 0.64 },
      4_000,
    );
    expect(gaps()).toEqual([]);
    expect(repo().get(closed)).toMatchObject({
      editedAt: 1_000,
      updatedAt: 1_000,
      scalpPrices: {
        tradeId: closed,
        entryPrice: 230.83,
        holdHigh: 233.21,
        holdLow: 230.71,
        optionHigh: 1.37,
        optionLow: 0.64,
        fetchedAt: 4_000,
      },
    });
  });

  it("drops a scalp's fetched prices when its ticker changes or a time moves to another minute", () => {
    const id = repo().create(nvda).id;
    const fetched = () =>
      repo().setScalpPrices(id, { entryPrice: 230.83, holdHigh: 233.21, holdLow: 230.71 }, 2_000);
    fetched();
    repo().update(id, { openedAt: nvda.openedAt + 20_000, grade: "B" });
    expect(repo().get(id)?.scalpPrices).not.toBeNull();
    repo().update(id, { openedAt: nvda.openedAt + 60_000 });
    expect(repo().get(id)?.scalpPrices).toBeNull();
    fetched();
    repo().update(id, { closedAt: (nvda.closedAt ?? 0) + 60_000 });
    expect(repo().get(id)?.scalpPrices).toBeNull();
    fetched();
    repo().update(id, { underlying: "AMD" });
    expect(repo().get(id)?.scalpPrices).toBeNull();
  });

  it("drops a typed stock at entry when the ticker changes or the entry moves to another minute", () => {
    const id = repo().create(nvda).id;
    const typed = () => repo().update(id, { scalp: { levelBasis: "stock", stockEntryOverride: 231 } });
    const override = () => repo().get(id)?.scalp?.stockEntryOverride;
    typed();
    repo().update(id, { openedAt: nvda.openedAt + 20_000, closedAt: (nvda.closedAt ?? 0) + 60_000 });
    expect(override()).toBe(231);
    repo().update(id, { openedAt: nvda.openedAt + 60_000 });
    expect(override()).toBeNull();
    typed();
    repo().update(id, { underlying: "AMD" });
    expect(override()).toBeNull();
    // A new stock typed with the move stands.
    repo().update(id, { underlying: "NVDA", scalp: { stockEntryOverride: 230.5 } });
    expect(override()).toBe(230.5);
  });

  it("asks for no option range before Alpaca's option history, nor of an open scalp", () => {
    const old = repo().create({
      ...nvda,
      openedAt: nyWallClock("2023-12-15", 600),
      closedAt: nyWallClock("2023-12-15", 610),
    }).id;
    repo().setScalpPrices(old, { entryPrice: 470, holdHigh: 471, holdLow: 469 }, 2_000);
    const open = repo().create({ ...nvda, closedAt: null, netPnl: null }).id;
    repo().setScalpPrices(open, { entryPrice: 230.83, holdHigh: null, holdLow: null }, 2_000);
    expect(
      repo()
        .missingScalpPrices()
        .map((gap) => gap.tradeId),
    ).toEqual([]);
  });

  it("drops a scalp's fetched prices when its contract changes, and keeps them when its legs come back the same", () => {
    const id = repo().create(nvda).id;
    repo().setScalpPrices(
      id,
      { entryPrice: 230.83, holdHigh: 233.21, holdLow: 230.71, optionHigh: 1.37, optionLow: 0.64 },
      2_000,
    );
    const [leg] = nvda.legs;
    if (!leg) throw new Error("no leg");
    repo().update(id, { legs: [{ ...leg }] });
    expect(repo().get(id)?.scalpPrices?.optionHigh).toBe(1.37);
    repo().update(id, { legs: [{ ...leg, strike: 235 }] });
    expect(repo().get(id)?.scalpPrices).toBeNull();
  });

  it("compares a premarket scalp's times by the minute, not clamped to the session as a fly's are", () => {
    const seven = nyWallClock("2026-09-28", 7 * 60);
    const id = repo().create({ ...nvda, openedAt: seven, closedAt: seven + 600_000 }).id;
    repo().setScalpPrices(id, { entryPrice: 229.1, holdHigh: 229.5, holdLow: 228.9 }, 2_000);
    repo().update(id, { openedAt: seven + 3_600_000, closedAt: seven + 4_200_000 });
    expect(repo().get(id)?.scalpPrices).toBeNull();
  });
});

describe("staleOptionRange", () => {
  const leg = { right: "C", strike: 232.5, expiry: "2026-09-28" };
  it("is stale only when a strike, expiry or right changes", () => {
    expect(staleOptionRange([leg], undefined)).toBe(false);
    expect(staleOptionRange([leg], [{ ...leg }])).toBe(false);
    expect(staleOptionRange([leg], [{ ...leg, strike: 235 }])).toBe(true);
    expect(staleOptionRange([leg], [{ ...leg, expiry: "2026-10-02" }])).toBe(true);
    expect(staleOptionRange([leg], [{ ...leg, right: "P" }])).toBe(true);
  });
});
