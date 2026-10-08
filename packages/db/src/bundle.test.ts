import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { journal, MIGRATIONS, scalp } from "./bundle.fixture.js";
import { BUNDLE_TABLES, canonical, exportBundle } from "./bundle.js";

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
