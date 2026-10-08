import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type NewTrade, nyWallClock } from "@tj/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { tags } from "../schema.js";
import { createTaxonomyRepo } from "./taxonomy.js";
import { createTradesRepo, ReviewRuleError } from "./trades.js";

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));
const ENTRY = nyWallClock("2026-09-30", 9 * 60 + 41);
const EXIT = nyWallClock("2026-09-30", 9 * 60 + 58);

/** A missed NVDA long, marked at 09:41 on Sep 30 with only its entry. */
const missedLong: NewTrade = {
  strategy: "scalp",
  book: "missed",
  underlying: "NVDA",
  underlyingName: null,
  structureLabel: null,
  openedAt: ENTRY,
  closedAt: null,
  netPnl: null,
  fees: 0,
  feesOpen: null,
  feesClose: null,
  notes: null,
  grade: null,
  excluded: false,
  excludeReason: null,
  source: "manual",
  setupId: null,
  tagIds: [],
  legs: [],
  ironFly: null,
  missed: { direction: "long", entryPrice: 178.42, stopPrice: null, targetPrice: null, exitPrice: null },
};

describe("missed trades in the trades repository", () => {
  let db: Db;
  let clock = 1_000;
  const repo = () => createTradesRepo(db, () => clock);
  const taxonomy = () => createTaxonomyRepo(db, () => clock);

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-missed-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
    clock = 1_000;
  });
  afterEach(() => db.$client.close());

  it("stores a missed trade's levels with it", () => {
    const created = repo().create(missedLong);
    expect(created.missed).toEqual(missedLong.missed);
    expect(created.closedAt).toBeNull();
    expect(created.accountId).toBeNull();
    expect(repo().get(created.id)?.missed).toEqual(missedLong.missed);
  });

  it("has no missed details on a taken trade", () => {
    const created = repo().create({ ...missedLong, book: "live", missed: null });
    expect(created.missed).toBeNull();
  });

  it("patches the levels one at a time, keeping the rest", () => {
    const { id } = repo().create(missedLong);
    repo().update(id, { missed: { stopPrice: 177.8 } });
    repo().update(id, { missed: { targetPrice: 181.2 } });
    const closed = repo().update(id, { missed: { exitPrice: 179.9 }, closedAt: EXIT });
    expect(closed?.missed).toEqual({
      direction: "long",
      entryPrice: 178.42,
      stopPrice: 177.8,
      targetPrice: 181.2,
      exitPrice: 179.9,
    });
    expect(closed?.closedAt).toBe(EXIT);
  });

  it("clears the exit's time and price together", () => {
    const { id } = repo().create({
      ...missedLong,
      closedAt: EXIT,
      missed: { ...missedLong.missed, stopPrice: 177.8, exitPrice: 179.9 } as NewTrade["missed"],
    });
    const open = repo().update(id, { missed: { exitPrice: null }, closedAt: null });
    expect(open?.missed?.exitPrice).toBeNull();
    expect(open?.closedAt).toBeNull();
  });

  it("refuses half an exit, against what's stored", () => {
    const { id } = repo().create(missedLong);
    expect(() => repo().update(id, { missed: { exitPrice: 179.9 } })).toThrow(
      new ReviewRuleError("an exit needs both a time and a price"),
    );
    expect(() => repo().update(id, { closedAt: EXIT })).toThrow("an exit needs both a time and a price");
  });

  it("refuses an exit at or before the entry", () => {
    const { id } = repo().create(missedLong);
    expect(() => repo().update(id, { missed: { exitPrice: 179.9 }, closedAt: ENTRY })).toThrow(
      "The exit must come after the entry",
    );
    expect(() => repo().update(id, { openedAt: EXIT + 60_000 })).not.toThrow();
  });

  it("refuses an exit on another day", () => {
    const { id } = repo().create(missedLong);
    expect(() =>
      repo().update(id, { missed: { exitPrice: 179.9 }, closedAt: nyWallClock("2026-10-01", 9 * 60 + 35) }),
    ).toThrow("The exit must be on the entry's day, Sep 30");
  });

  it("refuses missed details on a taken trade", () => {
    const { id } = repo().create({ ...missedLong, book: "live", missed: null });
    expect(() => repo().update(id, { missed: { stopPrice: 1 } })).toThrow(
      "Only a missed trade has missed details",
    );
  });

  it("forgets the hold range when the entry moves to another minute", () => {
    const { id } = repo().create({
      ...missedLong,
      closedAt: EXIT,
      missed: { ...missedLong.missed, stopPrice: 177.8, exitPrice: 179.9 } as NewTrade["missed"],
    });
    repo().setScalpPrices(id, { entryPrice: null, holdHigh: 180.34, holdLow: 178.23 }, 2_000);
    expect(repo().get(id)?.scalpPrices?.holdHigh).toBe(180.34);
    repo().update(id, { openedAt: ENTRY + 60_000, missed: { entryPrice: 178.5 } });
    expect(repo().get(id)?.scalpPrices).toBeNull();
  });

  it("allows one skip reason a trade, beside an emotion", () => {
    const hesitated = taxonomy().createTag({ name: "Hesitated", kind: "skip" });
    const late = taxonomy().createTag({ name: "Saw it late", kind: "skip" });
    const calm = taxonomy().createTag({ name: "Calm", kind: "emotion" });
    const { id } = repo().create(missedLong);
    expect(() => repo().update(id, { tagIds: [hesitated.id, late.id] })).toThrow(
      "A trade has at most one skip reason",
    );
    expect(
      repo()
        .update(id, { tagIds: [hesitated.id, calm.id] })
        ?.tagIds.sort(),
    ).toEqual([hesitated.id, calm.id].sort());
  });

  it("keeps a trade missed or taken: a patch can't move it across", () => {
    const missed = repo().create(missedLong);
    expect(() => repo().update(missed.id, { book: "live" })).toThrow(
      "A missed trade can't become a taken one",
    );
    const taken = repo().create({ ...missedLong, book: "live", missed: null });
    expect(() => repo().update(taken.id, { book: "missed" })).toThrow(
      "A taken trade can't become a missed one",
    );
    expect(repo().update(taken.id, { book: "paper" })?.book).toBe("paper");
    expect(repo().update(missed.id, { book: "missed", notes: "kept" })?.notes).toBe("kept");
  });

  it("gives a missed trade no P&L or other strategy through a patch", () => {
    const { id } = repo().create(missedLong);
    expect(() => repo().update(id, { netPnl: 50 })).toThrow("A missed trade is a scalp with no legs or P&L");
    expect(() => repo().update(id, { strategy: "iron_fly" })).toThrow(
      "A missed trade is a scalp with no legs or P&L",
    );
    expect(repo().get(id)?.netPnl).toBeNull();
  });

  it("allows one skip reason and one emotion on a new trade too", () => {
    const hesitated = taxonomy().createTag({ name: "Hesitated", kind: "skip" });
    const late = taxonomy().createTag({ name: "Saw it late", kind: "skip" });
    const calm = taxonomy().createTag({ name: "Calm", kind: "emotion" });
    const rushed = taxonomy().createTag({ name: "Rushed", kind: "emotion" });
    expect(() => repo().create({ ...missedLong, tagIds: [hesitated.id, late.id] })).toThrow(
      "A trade has at most one skip reason",
    );
    expect(() => repo().create({ ...missedLong, tagIds: [calm.id, rushed.id] })).toThrow(
      "A trade has at most one emotion",
    );
    expect(repo().create({ ...missedLong, tagIds: [hesitated.id, calm.id] }).tagIds).toHaveLength(2);
  });

  it("lists taken trades without the missed ones, and the missed ones alone", () => {
    const missed = repo().create(missedLong);
    const taken = repo().create({ ...missedLong, book: "live", missed: null });
    expect(
      repo()
        .list({ taken: true })
        .map((trade) => trade.id),
    ).toEqual([taken.id]);
    expect(
      repo()
        .list({ book: "missed" })
        .map((trade) => trade.id),
    ).toEqual([missed.id]);
  });

  it("asks the filler for a missed trade's hold range, never an option's", () => {
    const { id } = repo().create({
      ...missedLong,
      closedAt: EXIT,
      missed: { ...missedLong.missed, stopPrice: 177.8, exitPrice: 179.9 } as NewTrade["missed"],
    });
    expect(repo().missingScalpPrices([id])).toHaveLength(1);
    repo().setScalpPrices(id, { entryPrice: null, holdHigh: 180.34, holdLow: 178.23 }, 2_000);
    expect(repo().missingScalpPrices([id])).toEqual([]);
  });
});

describe("skip reasons in the taxonomy", () => {
  let db: Db;
  const repo = () => createTaxonomyRepo(db, () => 1_000);
  const skips = () =>
    repo()
      .listTags()
      .filter((tag) => tag.kind === "skip")
      .map((tag) => tag.name);

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-skips-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
  });
  afterEach(() => db.$client.close());

  const SEEDED = [
    "Hesitated",
    "Saw it late",
    "Away from screen",
    "Already in a trade",
    "Hit daily loss limit",
    "Didn't meet my rules",
  ];

  it("seeds the six skip reasons with the other tags", () => {
    repo().seedDefaults();
    expect(skips().sort()).toEqual([...SEEDED].sort());
    expect(
      repo()
        .listTags()
        .some((tag) => tag.kind === "mistake"),
    ).toBe(true);
  });

  it("seeds them into a journal that already has its tags", () => {
    repo().createTag({ name: "Chased", kind: "mistake" });
    repo().seedDefaults();
    expect(skips().sort()).toEqual([...SEEDED].sort());
    expect(
      repo()
        .listTags()
        .filter((tag) => tag.kind === "mistake"),
    ).toHaveLength(1);
  });

  it("doesn't bring them back once they're all deleted", () => {
    repo().seedDefaults();
    db.update(tags).set({ deletedAt: 2_000 }).where(eq(tags.kind, "skip")).run();
    repo().seedDefaults();
    expect(skips()).toEqual([]);
  });

  it("refuses a second skip reason with the same name", () => {
    repo().createTag({ name: "Hesitated", kind: "skip" });
    expect(() => repo().createTag({ name: "hesitated", kind: "skip" })).toThrow(
      "A skip reason with that name exists",
    );
  });
});
