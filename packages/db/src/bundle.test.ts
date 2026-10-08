import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addFill, bundleOf, dump, journal, MIGRATIONS, scalp } from "./bundle.fixture.js";
import { BUNDLE_TABLES, canonical, exportBundle, mergeBundle, readTable } from "./bundle.js";

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
    const setups = readTable(b.db, "setups");
    const tags = readTable(b.db, "tags");
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
    expect(readTable(a.db, "setups")).toEqual([
      expect.objectContaining({ id: keptSetup, name: "breakout", archived: 1 }),
    ]);
    expect(readTable(a.db, "tags").map((row) => row.id)).toEqual([keptTag]);
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
