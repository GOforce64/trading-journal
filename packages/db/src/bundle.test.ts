import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NewTrade } from "@tj/core";
import { describe, expect, it } from "vitest";
import { addFill, bundleOf, copyOf, dump, journal, MIGRATIONS, scalp } from "./bundle.fixture.js";
import { BUNDLE_TABLES, canonical, exportBundle, mergeBundle, type Row, readTable } from "./bundle.js";
import { createAttachmentsRepo } from "./repositories/attachments.js";

const MIGRATION_COUNT = (
  JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: unknown[] }
).entries.length;

describe("exportBundle", () => {
  it("carries every table the user made or synced, as rows, with a manifest", () => {
    const { db, clock, trades, taxonomy } = journal();
    const calm = taxonomy.createTag({ name: "Calm", kind: "emotion" });
    const kept = trades.create(scalp);
    trades.update(kept.id, {
      tagIds: [calm.id],
      scalp: { levelBasis: "stock", stopPrice: 229, targets: [{ price: 233, contracts: 2 }] },
    });
    const gone = trades.create({ ...scalp, underlying: "AMD" });
    clock.now = 2_000;
    trades.softDelete(gone.id);

    const bundle = exportBundle(db, { machine: "fedora", now: () => 5_000 });
    expect(bundle.manifest).toMatchObject({
      format: 1,
      schema: MIGRATION_COUNT,
      machine: "fedora",
      exportedAt: 5_000,
    });
    expect(Object.keys(bundle.tables)).toEqual([...BUNDLE_TABLES]);
    expect(Object.keys(bundle.tables)).not.toContain("scalp_prices");
    for (const table of BUNDLE_TABLES)
      expect(bundle.manifest.counts[table]).toBe(bundle.tables[table].length);
    expect(bundle.tables.trades.find((row) => row.id === kept.id)).toMatchObject({
      underlying: "NVDA",
      opened_at: scalp.openedAt,
      deleted_at: null,
    });
    expect(bundle.tables.trades.find((row) => row.id === gone.id)?.deleted_at).toBe(2_000);
    expect(bundle.tables.legs.filter((row) => row.trade_id === kept.id)).toHaveLength(1);
    expect(bundle.tables.scalp_details).toEqual([
      expect.objectContaining({ trade_id: kept.id, stop_price: 229 }),
    ]);
    expect(bundle.tables.scalp_targets).toEqual([
      expect.objectContaining({ trade_id: kept.id, position: 1, price: 233, contracts: 2 }),
    ]);
    expect(bundle.tables.trade_tags).toEqual([{ trade_id: kept.id, tag_id: calm.id }]);
  });
});

describe("canonical", () => {
  it("sorts keys at every depth, so equal content reads the same", () => {
    expect(canonical({ b: 1, a: [2, { d: null, c: "x" }] })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
    expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }));
  });
});

describe("mergeBundle", () => {
  /** A on its own, and B holding a copy of A's trade, as after a first merge. */
  function shared() {
    const a = journal();
    const b = journal();
    const trade = a.trades.create(scalp);
    mergeBundle(b.db, bundleOf(a.db));
    return { a, b, id: trade.id };
  }
  const grade = (j: ReturnType<typeof journal>, id: string) => j.trades.get(id)?.grade ?? null;

  it("brings everything into an empty journal, seeded setups and tags collapsing onto one id each", () => {
    const a = journal();
    const b = journal();
    a.taxonomy.seedDefaults();
    b.taxonomy.seedDefaults();
    const orb = a.taxonomy.listSetups().find((setup) => setup.name === "ORB breakout");
    const calm = a.taxonomy.listTags().find((tag) => tag.name === "Calm");
    const tagged = a.trades.create({ ...scalp, setupId: orb?.id ?? null, tagIds: calm ? [calm.id] : [] });
    a.trades.create({ ...scalp, underlying: "AMD" });
    const gone = a.trades.create({ ...scalp, underlying: "TSLA" });
    a.clock.now = 2_000;
    a.trades.softDelete(gone.id);
    addFill(a.db, { id: "f1", tradeId: tagged.id, commission: 1.1, updatedAt: 1 });

    const summary = mergeBundle(b.db, bundleOf(a.db));
    // Both machines seeded the same names: none of them is new here, whichever id each keeps.
    expect(summary).toMatchObject({
      added: 2,
      updated: 0,
      kept: 0,
      deleted: 0,
      fillsAdded: 1,
      setupsAdded: 0,
      tagsAdded: 0,
      unchanged: false,
    });
    // The seeds each machine made under its own ids: one live row per name, the rest merged into it.
    const live = (row: Row) => row.deleted_at == null;
    const setups = readTable(b.db, "setups").filter(live);
    const tags = readTable(b.db, "tags").filter(live);
    for (const table of ["setups", "tags"] as const) {
      const liveIds = new Set(
        readTable(b.db, table)
          .filter(live)
          .map((row) => row.id),
      );
      for (const row of readTable(b.db, table).filter((each) => !live(each))) {
        expect(liveIds).toContain(row.merged_into);
      }
    }
    expect(new Set(setups.map((row) => String(row.name).toLowerCase())).size).toBe(setups.length);
    expect(new Set(tags.map((row) => `${row.kind} ${String(row.name).toLowerCase()}`)).size).toBe(
      tags.length,
    );
    const setupIds = new Set(setups.map((row) => row.id));
    const tagIds = new Set(tags.map((row) => row.id));
    for (const row of readTable(b.db, "trades"))
      if (row.setup_id != null) expect(setupIds).toContain(row.setup_id);
    for (const row of readTable(b.db, "trade_tags")) expect(tagIds).toContain(row.tag_id);
    // The smaller id of each pair is kept.
    const orbIds = [orb?.id, ...b.taxonomy.listSetups().map((setup) => setup.id)];
    expect(b.trades.get(tagged.id)?.setupId).toBe(
      orbIds.filter((id) => setups.some((row) => row.id === id && row.name === "ORB breakout")).sort()[0],
    );
    expect(readTable(b.db, "trades").find((row) => row.id === gone.id)?.deleted_at).toBe(2_000);
  });

  it("changes nothing when the same bundle comes again", () => {
    const { a, b } = shared();
    addFill(a.db, { id: "f1", tradeId: null, commission: 1, updatedAt: 1 });
    const bundle = bundleOf(a.db);
    mergeBundle(b.db, bundle);
    const before = dump(b.db);
    expect(mergeBundle(b.db, bundle)).toMatchObject({ unchanged: true, added: 0, updated: 0, kept: 0 });
    expect(dump(b.db)).toEqual(before);
  });

  it("keeps the later edit, whichever side made it", () => {
    const { a, b, id } = shared();
    a.clock.now = 3_000;
    a.trades.update(id, { grade: "C" });
    b.clock.now = 5_000;
    b.trades.update(id, { grade: "A" });
    expect(mergeBundle(b.db, bundleOf(a.db))).toMatchObject({ kept: 1, updated: 0 });
    expect(grade(b, id)).toBe("A");
    expect(mergeBundle(a.db, bundleOf(b.db))).toMatchObject({ updated: 1, kept: 0 });
    expect(grade(a, id)).toBe("A");
    expect(dump(a.db)).toEqual(dump(b.db));
  });

  it("picks the same version on both sides when two edits share a time", () => {
    const { a, b, id } = shared();
    a.clock.now = 4_000;
    b.clock.now = 4_000;
    a.trades.update(id, { notes: "from A" });
    b.trades.update(id, { notes: "from B" });
    const fromA = bundleOf(a.db);
    const fromB = bundleOf(b.db);
    mergeBundle(a.db, fromB);
    mergeBundle(b.db, fromA);
    expect(dump(a.db)).toEqual(dump(b.db));
  });

  it("lets a delete win over an earlier edit, and a later edit bring the trade back", () => {
    const first = shared();
    first.a.clock.now = 5_000;
    first.a.trades.update(first.id, { grade: "B" });
    first.b.clock.now = 6_000;
    first.b.trades.softDelete(first.id);
    expect(mergeBundle(first.a.db, bundleOf(first.b.db))).toMatchObject({ deleted: 1 });
    expect(first.a.trades.get(first.id)).toBeNull();

    const second = shared();
    second.b.clock.now = 5_000;
    second.b.trades.softDelete(second.id);
    second.a.clock.now = 6_000;
    second.a.trades.update(second.id, { grade: "B" });
    expect(mergeBundle(second.b.db, bundleOf(second.a.db))).toMatchObject({ updated: 1 });
    expect(grade(second.b, second.id)).toBe("B");
  });

  it("takes the newer sync of a trade nobody edited, but never over an edit", () => {
    const a = journal();
    const b = journal();
    const synced = a.trades.create({ ...scalp, source: "ibkr_flex" });
    mergeBundle(b.db, bundleOf(a.db));
    // A later sync on B moved the trade's facts.
    b.db.$client.prepare("update trades set net_pnl = 50, updated_at = 9000 where id = ?").run(synced.id);
    expect(mergeBundle(a.db, bundleOf(b.db))).toMatchObject({ updated: 1 });
    expect(a.trades.get(synced.id)?.netPnl).toBe(50);
    // An edit on A, even at an earlier time, beats a sync-only version.
    a.clock.now = 2_000;
    a.trades.update(synced.id, { grade: "A" });
    b.db.$client.prepare("update trades set net_pnl = 60, updated_at = 99000 where id = ?").run(synced.id);
    expect(mergeBundle(a.db, bundleOf(b.db))).toMatchObject({ kept: 1 });
    expect(a.trades.get(synced.id)).toMatchObject({ grade: "A", netPnl: 50 });
  });

  it("unions fills by id, the newer write of the same fill winning on both sides", () => {
    const { a, b, id } = shared();
    addFill(a.db, { id: "f1", tradeId: id, commission: 0.9, updatedAt: 10 });
    addFill(b.db, { id: "f1", tradeId: id, commission: 1.1, updatedAt: 20 });
    addFill(a.db, { id: "f2", tradeId: id, commission: 1, updatedAt: 10 });
    addFill(b.db, { id: "f3", tradeId: id, commission: 1, updatedAt: 10 });
    const fromA = bundleOf(a.db);
    expect(mergeBundle(a.db, bundleOf(b.db))).toMatchObject({ fillsAdded: 1 });
    expect(mergeBundle(b.db, fromA)).toMatchObject({ fillsAdded: 1 });
    const fills = readTable(a.db, "fills");
    expect(fills.map((row) => row.id).sort()).toEqual(["f1", "f2", "f3"]);
    expect(fills.find((row) => row.id === "f1")?.commission).toBe(1.1);
    expect(dump(a.db)).toEqual(dump(b.db));
  });

  it("drops the fetched prices of a trade the bundle replaced, and keeps those of one it didn't", () => {
    const { a, b, id } = shared();
    const other = b.trades.create({ ...scalp, underlying: "AMD" });
    for (const tradeId of [id, other.id]) {
      b.trades.setScalpPrices(tradeId, { entryPrice: 230.8, holdHigh: 233, holdLow: 230 }, 1);
    }
    a.clock.now = 3_000;
    a.trades.update(id, { grade: "A" });
    mergeBundle(b.db, bundleOf(a.db));
    expect(b.trades.get(id)?.scalpPrices).toBeNull();
    expect(b.trades.get(other.id)?.scalpPrices).not.toBeNull();
  });

  it("makes setups and tags of the same name one, on the smaller id, with the newer fields", () => {
    const a = journal();
    const b = journal();
    const setupA = a.taxonomy.createSetup({ name: "Breakout" });
    const setupB = b.taxonomy.createSetup({ name: "breakout" });
    const tagA = a.taxonomy.createTag({ name: "Bored", kind: "emotion" });
    const tagB = b.taxonomy.createTag({ name: "Bored", kind: "emotion" });
    const onA = a.trades.create({ ...scalp, setupId: setupA.id, tagIds: [tagA.id] });
    const onB = b.trades.create({ ...scalp, underlying: "AMD", setupId: setupB.id, tagIds: [tagB.id] });
    b.clock.now = 7_000;
    b.taxonomy.updateSetup(setupB.id, { archived: true });
    const fromA = bundleOf(a.db);
    mergeBundle(a.db, bundleOf(b.db));
    mergeBundle(b.db, fromA);
    expect(dump(a.db)).toEqual(dump(b.db));
    const keptSetup = [setupA.id, setupB.id].sort()[0];
    const keptTag = [tagA.id, tagB.id].sort()[0];
    const lost = (id: string | undefined) => (id === setupA.id ? setupB.id : setupA.id);
    expect(readTable(a.db, "setups").filter((row) => row.deleted_at == null)).toEqual([
      expect.objectContaining({ id: keptSetup, name: "breakout", archived: 1 }),
    ]);
    // Stamped with its own last write: B archived it at 7,000; A's copy was last written at 1,000.
    const tombstone = readTable(a.db, "setups").find((row) => row.id === lost(keptSetup));
    expect(tombstone).toMatchObject({ merged_into: keptSetup });
    expect(tombstone?.deleted_at).toBe(tombstone?.updated_at);
    expect(
      readTable(a.db, "tags")
        .filter((row) => row.deleted_at == null)
        .map((row) => row.id),
    ).toEqual([keptTag]);
    const c = journal();
    expect(mergeBundle(c.db, bundleOf(a.db))).toMatchObject({ setupsAdded: 1, tagsAdded: 1 });
    expect(a.trades.get(onA.id)).toMatchObject({ setupId: keptSetup, tagIds: [keptTag] });
    expect(a.trades.get(onB.id)).toMatchObject({ setupId: keptSetup, tagIds: [keptTag] });
  });

  it("merges a bundle from an older app, keeping local values of the columns it lacks", () => {
    const { a, b, id } = shared();
    b.clock.now = 2_000;
    b.trades.update(id, { reviewed: true });
    a.clock.now = 3_000;
    a.trades.update(id, { grade: "A" });
    const fresh = a.trades.create({ ...scalp, underlying: "AMD" });
    const old = bundleOf(a.db);
    for (const row of old.tables.trades) delete row.reviewed_at;
    expect(mergeBundle(b.db, old)).toMatchObject({ updated: 1, added: 1 });
    expect(b.trades.get(id)).toMatchObject({ grade: "A", reviewedAt: 2_000 });
    expect(b.trades.get(fresh.id)?.reviewedAt).toBeNull();
  });
});

describe("mergeBundle, after the final review", () => {
  it("takes renamed tags, even into a name another tag just freed, or a swap", () => {
    const a = journal();
    const b = journal();
    const calm = a.taxonomy.createTag({ name: "Calm", kind: "emotion" });
    const rushed = a.taxonomy.createTag({ name: "Rushed", kind: "emotion" });
    mergeBundle(b.db, bundleOf(a.db));
    a.clock.now = 2_000;
    a.taxonomy.updateTag(calm.id, { name: "Tmp" });
    a.taxonomy.updateTag(rushed.id, { name: "Calm" });
    a.taxonomy.updateTag(calm.id, { name: "Rushed" });
    expect(() => mergeBundle(b.db, bundleOf(a.db))).not.toThrow();
    expect(readTable(b.db, "tags").map((row) => [row.id, row.name])).toEqual(
      expect.arrayContaining([
        [calm.id, "Rushed"],
        [rushed.id, "Calm"],
      ]),
    );
    expect(mergeBundle(a.db, bundleOf(b.db)).unchanged).toBe(true);
  });

  it("settles a bundle whose child rows lack a column, counting nothing for trades that are the same", () => {
    const a = journal();
    const b = journal();
    const trade = a.trades.create(scalp);
    a.trades.update(trade.id, { scalp: { levelBasis: "stock", stopPrice: 229, riskOverride: 120 } });
    mergeBundle(b.db, bundleOf(a.db));
    const old = bundleOf(a.db);
    for (const row of old.tables.scalp_details) delete row.risk_override;
    expect(mergeBundle(b.db, old)).toMatchObject({ updated: 0, kept: 0, unchanged: true });
    expect(b.trades.get(trade.id)?.scalp?.riskOverride).toBe(120);
  });

  it("keeps a fetched stock price and a fill's link, from whichever side has them", () => {
    const a = journal();
    const b = journal();
    const fly = a.trades.create({
      ...scalp,
      strategy: "iron_fly",
      legs: [],
      ironFly: {
        bodyPutStrike: 47,
        bodyCallStrike: 47,
        putWingStrike: 40,
        callWingStrike: 54,
        contracts: 2,
        creditPerShare: 2.5,
        netCost: null,
        earningsDate: null,
        earningsTiming: null,
        impliedMovePct: null,
        actualMovePct: null,
        ivBefore: null,
        ivAfter: null,
        sourceNotes: null,
      },
    });
    addFill(a.db, { id: "f1", tradeId: null, commission: 1, updatedAt: 10 });
    mergeBundle(b.db, bundleOf(a.db));
    // Only A fetched the price, and only B's sync linked the fill: neither moves a timestamp.
    a.trades.setUnderlyingPrice(fly.id, "entry", 47.25);
    b.db.$client.prepare("update fills set trade_id = ? where id = 'f1'").run(fly.id);
    const fromA = bundleOf(a.db);
    mergeBundle(a.db, bundleOf(b.db));
    mergeBundle(b.db, fromA);
    expect(dump(a.db)).toEqual(dump(b.db));
    expect(readTable(a.db, "iron_fly_details")[0]?.underlying_price_entry).toBe(47.25);
    expect(readTable(a.db, "fills")[0]?.trade_id).toBe(fly.id);
  });
});

describe("mergeBundle and tags merged into one", () => {
  it("doesn't bring back a merged tag from an old bundle, merging the same bundle twice or not", () => {
    const base = journal(1_000);
    base.taxonomy.seedDefaults();
    const [first, second] = base.taxonomy
      .listTags()
      .filter((tag) => tag.kind === "mistake")
      .map((tag) => tag.id)
      .sort();
    if (!first || !second) throw new Error("no mistake tags");
    const a = copyOf(base, 10_005);
    const b = copyOf(base, 10_005);
    // Each machine renames a different tag to the same name, at the same moment.
    a.taxonomy.updateTag(second, { name: "Rushed" });
    b.taxonomy.updateTag(first, { name: "Rushed" });
    const fromA = bundleOf(a.db);
    const fromB = bundleOf(b.db);
    mergeBundle(a.db, fromB);
    mergeBundle(b.db, fromA);
    expect(dump(a.db)).toEqual(dump(b.db));
    const names = (j: ReturnType<typeof journal>) =>
      j.taxonomy
        .listTags()
        .filter((tag) => tag.kind === "mistake")
        .map((tag) => tag.name);
    expect(names(a).filter((name) => name === "Rushed")).toHaveLength(1);
    const settled = dump(a.db);
    expect(mergeBundle(a.db, fromB).unchanged).toBe(true);
    expect(mergeBundle(b.db, fromA).unchanged).toBe(true);
    expect(dump(a.db)).toEqual(settled);
    // The tag merged away keeps its name, deleted, but never blocks it.
    const kept = a.taxonomy.listTags().find((tag) => tag.kind === "mistake" && tag.name === "Rushed");
    a.taxonomy.updateTag(kept?.id ?? "", { name: "Hasty" });
    expect(() => a.taxonomy.createTag({ name: "Rushed", kind: "mistake" })).not.toThrow();
  });
});

describe("mergeBundle and tags merged into one, after the tombstone review", () => {
  /** Two machines sharing two emotion tags, the smaller id first. */
  function sharedTags() {
    const base = journal(1_000);
    const one = base.taxonomy.createTag({ name: "Calm", kind: "emotion" });
    const two = base.taxonomy.createTag({ name: "Rushed", kind: "emotion" });
    const [small, large] = [one.id, two.id].sort();
    if (!small || !large) throw new Error("no tags");
    return { base, small, large };
  }
  const live = (j: ReturnType<typeof journal>) =>
    readTable(j.db, "tags")
      .filter((row) => row.deleted_at == null)
      .map((row) => [row.id, row.name]);

  it("lets a tombstone win a tie with a stale live copy, so nothing comes back", () => {
    const { base, small, large } = sharedTags();
    const a = copyOf(base, 10_014);
    const b = copyOf(base, 10_007);
    b.taxonomy.updateTag(small, { name: "Zeta" });
    b.clock.now = 10_014;
    b.taxonomy.updateTag(large, { name: "Alpha" });
    a.taxonomy.updateTag(large, { name: "Zeta" });
    const fromA = bundleOf(a.db);
    const fromB = bundleOf(b.db);
    mergeBundle(a.db, fromB);
    mergeBundle(b.db, fromA);
    expect(dump(a.db)).toEqual(dump(b.db));
    expect(mergeBundle(a.db, fromB).unchanged).toBe(true);
    expect(mergeBundle(b.db, fromA).unchanged).toBe(true);
    expect(dump(a.db)).toEqual(dump(b.db));
  });

  it("keeps a rename made after an older bundle, when that bundle merged the tag away elsewhere", () => {
    const { base, small, large } = sharedTags();
    const a = copyOf(base, 2_100);
    const b = copyOf(base, 2_300);
    a.taxonomy.updateTag(large, { name: "Zeta" });
    const older = bundleOf(a.db);
    a.clock.now = 2_200;
    a.taxonomy.updateTag(large, { name: "Calm2" });
    b.taxonomy.updateTag(small, { name: "Zeta" });
    mergeBundle(b.db, older);
    mergeBundle(a.db, bundleOf(b.db));
    expect(live(a)).toEqual(
      expect.arrayContaining([
        [large, "Calm2"],
        [small, "Zeta"],
      ]),
    );
  });
});

describe("mergeBundle and screenshots", () => {
  const IMAGE = { sha256: "c".repeat(64), ext: "png", mime: "image/png", bytes: 10 };

  it("carries a trade's screenshots with it, both ways", () => {
    const a = journal(1_000);
    const b = journal(1_000);
    const trade = a.trades.create(scalp);
    a.clock.now = 2_000;
    createAttachmentsRepo(a.db, () => a.clock.now).create(trade.id, IMAGE);
    mergeBundle(b.db, bundleOf(a.db));
    expect(b.trades.get(trade.id)?.attachments).toEqual([
      expect.objectContaining({ sha256: "c".repeat(64) }),
    ]);
    expect(mergeBundle(a.db, bundleOf(b.db)).unchanged).toBe(true);
  });

  it("keeps a screenshot added on one machine when the other machine's later edit wins the trade", () => {
    const a = journal(1_000);
    const b = journal(1_000);
    const trade = a.trades.create(scalp);
    mergeBundle(b.db, bundleOf(a.db));
    a.clock.now = 2_000;
    createAttachmentsRepo(a.db, () => a.clock.now).create(trade.id, IMAGE);
    b.clock.now = 3_000;
    b.trades.update(trade.id, { grade: "A" });
    expect(mergeBundle(a.db, bundleOf(b.db))).toMatchObject({ updated: 1, screenshotsAdded: 0 });
    expect(mergeBundle(b.db, bundleOf(a.db))).toMatchObject({ updated: 0, screenshotsAdded: 1 });
    for (const side of [a, b]) {
      expect(side.trades.get(trade.id)).toMatchObject({
        grade: "A",
        attachments: [expect.objectContaining({ sha256: "c".repeat(64) })],
      });
    }
    expect(dump(a.db)).toEqual(dump(b.db));
  });

  it("removes a screenshot on both machines once either removes it, and keeps the newer caption", () => {
    const a = journal(1_000);
    const b = journal(1_000);
    const trade = a.trades.create(scalp);
    const shots = createAttachmentsRepo(a.db, () => a.clock.now);
    const gone = shots.create(trade.id, IMAGE);
    const kept = shots.create(trade.id, { ...IMAGE, sha256: "d".repeat(64) });
    if (!gone || !kept) throw new Error("not attached");
    mergeBundle(b.db, bundleOf(a.db));
    a.clock.now = 2_000;
    shots.remove(gone.id);
    shots.setCaption(kept.id, "early");
    b.clock.now = 3_000;
    createAttachmentsRepo(b.db, () => b.clock.now).setCaption(kept.id, "later");
    mergeBundle(b.db, bundleOf(a.db));
    mergeBundle(a.db, bundleOf(b.db));
    for (const side of [a, b]) {
      expect(side.trades.get(trade.id)?.attachments).toEqual([
        expect.objectContaining({ id: kept.id, caption: "later" }),
      ]);
    }
    expect(dump(a.db)).toEqual(dump(b.db));
  });

  it("keeps local screenshots when a bundle from before them wins the trade", () => {
    const a = journal(1_000);
    const b = journal(1_000);
    const trade = a.trades.create(scalp);
    mergeBundle(b.db, bundleOf(a.db));
    b.clock.now = 2_000;
    createAttachmentsRepo(b.db, () => b.clock.now).create(trade.id, IMAGE);
    a.clock.now = 3_000;
    a.trades.update(trade.id, { grade: "A" });
    const old = bundleOf(a.db);
    delete (old.tables as Partial<typeof old.tables>).attachments;
    expect(mergeBundle(b.db, old)).toMatchObject({ updated: 1 });
    expect(b.trades.get(trade.id)).toMatchObject({
      grade: "A",
      attachments: [expect.objectContaining({ sha256: "c".repeat(64) })],
    });
  });
});

describe("mergeBundle and missed trades", () => {
  const missedTrade: NewTrade = {
    ...scalp,
    book: "missed",
    legs: [],
    netPnl: null,
    closedAt: null,
    missed: { direction: "long", entryPrice: 178.42, stopPrice: null, targetPrice: null, exitPrice: null },
  };

  it("carries a missed trade's levels in the bundle", () => {
    const a = journal();
    a.trades.create(missedTrade);
    expect(bundleOf(a.db).tables.missed_details).toEqual([
      {
        trade_id: expect.any(String),
        direction: "long",
        entry_price: 178.42,
        stop_price: null,
        target_price: null,
        exit_price: null,
      },
    ]);
  });

  it("moves the levels with the side whose trade wins, never mixing the two", () => {
    const a = journal(1_000);
    const b = journal(1_000);
    const { id } = a.trades.create(missedTrade);
    mergeBundle(b.db, bundleOf(a.db));
    a.clock.now = 3_000;
    a.trades.update(id, { missed: { stopPrice: 177.8 } });
    b.clock.now = 5_000;
    b.trades.update(id, { missed: { targetPrice: 181.2 } });
    // B's edit is newer: its whole trade wins, so A's stop doesn't arrive.
    expect(mergeBundle(a.db, bundleOf(b.db))).toMatchObject({ updated: 1 });
    expect(a.trades.get(id)?.missed).toMatchObject({ stopPrice: null, targetPrice: 181.2 });
    // The two journals are the same now: nothing moves back.
    expect(mergeBundle(b.db, bundleOf(a.db))).toMatchObject({ updated: 0, kept: 0 });
    expect(dump(a.db)).toEqual(dump(b.db));
  });

  it("keeps the local levels when a bundle from before missed trades wins the trade", () => {
    const a = journal(1_000);
    const b = journal(1_000);
    const { id } = a.trades.create(missedTrade);
    mergeBundle(b.db, bundleOf(a.db));
    a.clock.now = 3_000;
    a.trades.update(id, { grade: "A" });
    const old = bundleOf(a.db);
    delete (old.tables as Partial<typeof old.tables>).missed_details;
    expect(mergeBundle(b.db, old)).toMatchObject({ updated: 1 });
    expect(b.trades.get(id)).toMatchObject({ grade: "A", missed: { entryPrice: 178.42 } });
  });
});
