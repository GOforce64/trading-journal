import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IronFlyDetailsInput, NewTrade } from "@tj/core";
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

  it("lists 500 trades by default, and every trade when the limit is null", () => {
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
