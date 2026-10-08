import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { newTradeSchema } from "@tj/core";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { createTaxonomyRepo, DuplicateNameError } from "./taxonomy.js";
import { createTradesRepo } from "./trades.js";

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

describe("taxonomy repository", () => {
  let db: Db;
  const repo = () => createTaxonomyRepo(db, () => 1_000);

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-tax-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
  });

  it("creates and lists setups", () => {
    const created = repo().createSetup({ name: "Earnings IV crush", strategy: "iron_fly" });
    expect(created.name).toBe("Earnings IV crush");
    expect(repo().listSetups()).toHaveLength(1);
  });

  it("creates tags of both kinds", () => {
    repo().createTag({ name: "Moved stop", kind: "mistake" });
    repo().createTag({ name: "Calm", kind: "emotion" });
    expect(
      repo()
        .listTags()
        .map((tag) => tag.kind)
        .sort(),
    ).toEqual(["emotion", "mistake"]);
  });

  it("allows the same name in different kinds", () => {
    repo().createTag({ name: "Rushed", kind: "mistake" });
    expect(() => repo().createTag({ name: "Rushed", kind: "emotion" })).not.toThrow();
  });

  it("rejects a duplicate tag name within the same kind", () => {
    repo().createTag({ name: "FOMO entry", kind: "mistake" });
    expect(() => repo().createTag({ name: "FOMO entry", kind: "mistake" })).toThrow();
  });

  it("seeds defaults once and is idempotent", () => {
    repo().seedDefaults();
    const afterFirst = repo().listTags().length;
    repo().seedDefaults();
    expect(repo().listTags()).toHaveLength(afterFirst);
    expect(afterFirst).toBeGreaterThan(0);
    expect(repo().listSetups().length).toBeGreaterThan(0);
  });

  it("does not seed over setups the user already made", () => {
    repo().createSetup({ name: "My own setup" });
    repo().seedDefaults();
    expect(repo().listSetups()).toHaveLength(1);
  });

  it("renames, describes and re-scopes a setup, and archives and restores it", () => {
    const orb = repo().createSetup({ name: "ORB breakout", strategy: "scalp" });
    expect(
      repo().updateSetup(orb.id, {
        name: "Opening range break",
        description: "First 5 minutes",
        strategy: null,
      }),
    ).toMatchObject({ name: "Opening range break", description: "First 5 minutes", strategy: null });
    repo().updateSetup(orb.id, { archived: true });
    expect(repo().listSetups()).toHaveLength(0);
    expect(
      repo()
        .listSetups({ includeArchived: true })
        .map((setup) => setup.archived),
    ).toEqual([true]);
    repo().updateSetup(orb.id, { archived: false });
    expect(repo().listSetups()).toHaveLength(1);
    expect(repo().updateSetup(crypto.randomUUID(), { archived: true })).toBeNull();
  });

  it("refuses a setup name already taken, ignoring case, archived or not", () => {
    const orb = repo().createSetup({ name: "ORB breakout" });
    repo().updateSetup(orb.id, { archived: true });
    expect(() => repo().createSetup({ name: "orb BREAKOUT" })).toThrow(DuplicateNameError);
    const vwap = repo().createSetup({ name: "VWAP reclaim" });
    expect(() => repo().updateSetup(vwap.id, { name: "ORB Breakout" })).toThrow(
      "A setup with that name exists",
    );
    // Its own name, even with another case, is no clash.
    expect(repo().updateSetup(vwap.id, { name: "VWAP Reclaim" })?.name).toBe("VWAP Reclaim");
  });

  it("renames and archives a tag, refusing a name its own kind already has", () => {
    const fomo = repo().createTag({ name: "FOMO entry", kind: "mistake" });
    repo().createTag({ name: "Oversized", kind: "mistake" });
    repo().createTag({ name: "Rushed", kind: "emotion" });
    expect(() => repo().updateTag(fomo.id, { name: "oversized" })).toThrow(
      "A mistake tag with that name exists",
    );
    expect(() => repo().createTag({ name: "rushed", kind: "emotion" })).toThrow(
      "An emotion tag with that name exists",
    );
    // Another kind's name is fine.
    expect(repo().updateTag(fomo.id, { name: "Rushed" })?.name).toBe("Rushed");
    repo().updateTag(fomo.id, { archived: true });
    expect(
      repo()
        .listTags()
        .map((tag) => [tag.kind, tag.name]),
    ).toEqual([
      ["mistake", "Oversized"],
      ["emotion", "Rushed"],
    ]);
    expect(repo().updateTag(crypto.randomUUID(), { name: "Late" })).toBeNull();
  });

  it("counts the live trades using each setup and tag", () => {
    const orb = repo().createSetup({ name: "ORB breakout", strategy: "scalp" });
    const calm = repo().createTag({ name: "Calm", kind: "emotion" });
    const trades = createTradesRepo(db, () => 1_000);
    const scalp = newTradeSchema.parse({
      strategy: "scalp",
      book: "paper",
      underlying: "NVDA",
      openedAt: 1_000,
      setupId: orb.id,
      tagIds: [calm.id],
    });
    trades.create(scalp);
    trades.create(scalp);
    trades.softDelete(trades.create(scalp).id);
    expect(repo().listSetups()[0]?.tradeCount).toBe(2);
    expect(repo().listSetups()[0]?.missedCount).toBe(0);
    expect(repo().listTags()[0]?.tradeCount).toBe(2);
    // A missed trade on the setup counts apart from the trades taken on it.
    trades.create(
      newTradeSchema.parse({
        strategy: "scalp",
        book: "missed",
        underlying: "NVDA",
        openedAt: 1_000,
        setupId: orb.id,
        missed: {
          direction: "long",
          entryPrice: 178.42,
          stopPrice: null,
          targetPrice: null,
          exitPrice: null,
        },
      }),
    );
    expect(repo().listSetups()[0]).toMatchObject({ tradeCount: 2, missedCount: 1 });
    repo().createSetup({ name: "Unused" });
    expect(
      repo()
        .listSetups()
        .find((setup) => setup.name === "Unused")?.tradeCount,
    ).toBe(0);
  });
});
