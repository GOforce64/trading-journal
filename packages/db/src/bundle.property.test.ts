import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addFill, bundleOf, copyOf, dump, journal, scalp } from "./bundle.fixture.js";
import { mergeBundle, readTable } from "./bundle.js";
import { createAttachmentsRepo } from "./repositories/attachments.js";
import { DuplicateNameError } from "./repositories/taxonomy.js";

type Journal = ReturnType<typeof journal>;

/** One thing a person or a sync does on one machine. */
type Op =
  | { kind: "create"; underlying: string }
  | { kind: "edit"; pick: number; field: "grade" | "notes" | "stop"; value: number }
  | { kind: "delete"; pick: number }
  | { kind: "tag"; pick: number; tag: number }
  | { kind: "setup"; pick: number; name: string }
  | { kind: "fill"; pick: number; fill: number; commission: number }
  | { kind: "rename"; tag: number; name: string }
  | { kind: "attach"; pick: number; image: string };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("attach" as const), pick: fc.nat(9), image: fc.constantFrom("a", "b", "c") }),
  fc.record({
    kind: fc.constant("rename" as const),
    tag: fc.nat(9),
    name: fc.constantFrom("Calm", "Rushed", "Zen", "Bored"),
  }),
  fc.record({ kind: fc.constant("create" as const), underlying: fc.constantFrom("NVDA", "AMD", "TSLA") }),
  fc.record({
    kind: fc.constant("edit" as const),
    pick: fc.nat(9),
    field: fc.constantFrom("grade" as const, "notes" as const, "stop" as const),
    value: fc.nat(4),
  }),
  fc.record({ kind: fc.constant("delete" as const), pick: fc.nat(9) }),
  fc.record({ kind: fc.constant("tag" as const), pick: fc.nat(9), tag: fc.nat(9) }),
  fc.record({
    kind: fc.constant("setup" as const),
    pick: fc.nat(9),
    name: fc.constantFrom("ORB", "VWAP", "Gap"),
  }),
  fc.record({
    kind: fc.constant("fill" as const),
    pick: fc.nat(9),
    fill: fc.integer({ min: 1, max: 4 }),
    commission: fc.nat(3),
  }),
);

const live = (j: Journal) =>
  readTable(j.db, "trades")
    .filter((row) => row.deleted_at == null)
    .map((row) => String(row.id))
    .sort();
const nth = <T>(items: readonly T[], index: number): T | undefined =>
  items[index % Math.max(items.length, 1)];

/** Runs `ops` on one machine, its clock moving `step` each time. */
function apply(j: Journal, ops: readonly Op[], step: number): void {
  for (const each of ops) {
    j.clock.now += step;
    const trade = nth(live(j), "pick" in each ? each.pick : 0);
    switch (each.kind) {
      case "create":
        j.trades.create({ ...scalp, underlying: each.underlying });
        break;
      case "edit":
        if (!trade) break;
        if (each.field === "grade")
          j.trades.update(trade, { grade: (["A", "B", "C", "D", "F"] as const)[each.value] });
        else if (each.field === "notes") j.trades.update(trade, { notes: `note ${each.value}` });
        else j.trades.update(trade, { scalp: { levelBasis: "stock", stopPrice: 225 + each.value } });
        break;
      case "delete":
        if (trade) j.trades.softDelete(trade);
        break;
      case "tag": {
        const tag = nth(
          j.taxonomy
            .listTags({ includeArchived: true })
            .map((row) => row.id)
            .sort(),
          each.tag,
        );
        if (trade && tag) j.trades.update(trade, { tagIds: [tag] });
        break;
      }
      case "setup": {
        let id: string | undefined;
        try {
          id = j.taxonomy.createSetup({ name: each.name }).id;
        } catch (error) {
          if (!(error instanceof DuplicateNameError)) throw error;
          id = j.taxonomy.listSetups({ includeArchived: true }).find((row) => row.name === each.name)?.id;
        }
        if (trade && id) j.trades.update(trade, { setupId: id });
        break;
      }
      case "rename": {
        const tag = nth(
          j.taxonomy
            .listTags({ includeArchived: true })
            .map((row) => row.id)
            .sort(),
          each.tag,
        );
        try {
          if (tag) j.taxonomy.updateTag(tag, { name: each.name });
        } catch (error) {
          if (!(error instanceof DuplicateNameError)) throw error;
        }
        break;
      }
      case "attach":
        if (trade) {
          createAttachmentsRepo(j.db, () => j.clock.now).create(trade, {
            sha256: each.image.repeat(64),
            ext: "png",
            mime: "image/png",
            bytes: 10,
          });
        }
        break;
      case "fill":
        addFill(j.db, {
          id: `f${each.fill}`,
          tradeId: trade ?? null,
          commission: each.commission,
          updatedAt: j.clock.now,
        });
        break;
    }
  }
}

/** Two machines: copies of one journal, or two journals seeded on their own. */
function machines(related: boolean, shared: readonly Op[]) {
  const base = journal(1_000);
  base.taxonomy.seedDefaults();
  apply(base, shared, 3);
  if (related) return [copyOf(base, 10_000), copyOf(base, 10_000)] as const;
  const other = journal(1_000);
  other.taxonomy.seedDefaults();
  apply(other, shared, 5);
  return [base, other] as const;
}

/** The live setups' or tags' names: rows a merge folded into another stay on, deleted. */
const names = (j: Journal, table: "setups" | "tags") =>
  new Set(
    readTable(j.db, table)
      .filter((row) => row.deleted_at == null)
      .map((row) => `${row.kind ?? ""}:${String(row.name).toLowerCase()}`),
  );

describe("mergeBundle's guarantees (export-merge spec §4)", () => {
  it("is the same both ways, does nothing the second time, and loses nothing", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.array(op, { maxLength: 5 }),
        fc.array(op, { maxLength: 8 }),
        fc.array(op, { maxLength: 8 }),
        // Clocks that step alike make edits at the same moment, which only the content can break.
        fc.constantFrom([7, 7], [7, 11], [5, 5]),
        // The same trade edited on both machines at the same moment, differently: only the content can break it.
        fc.array(fc.record({ pick: fc.nat(9), a: fc.nat(4), b: fc.nat(4) }), { maxLength: 3 }),
        (related, shared, onA, onB, [stepA, stepB], together) => {
          const [a, b] = machines(related, shared);
          apply(a, onA, stepA ?? 7);
          apply(b, onB, stepB ?? 7);
          for (const each of together) {
            const moment = Math.max(a.clock.now, b.clock.now) + 1;
            a.clock.now = moment;
            b.clock.now = moment;
            const both = live(a).filter((id) => live(b).includes(id));
            const trade = nth(both, each.pick);
            if (!trade) continue;
            a.trades.update(trade, { notes: `A ${each.a}` });
            b.trades.update(trade, { notes: `B ${each.b}` });
          }
          const fromA = bundleOf(a.db);
          const fromB = bundleOf(b.db);
          const tradeIds = new Set([...fromA.tables.trades, ...fromB.tables.trades].map((row) => row.id));
          const fillIds = new Set([...fromA.tables.fills, ...fromB.tables.fills].map((row) => row.id));
          const setupNames = new Set([...names(a, "setups"), ...names(b, "setups")]);
          // A tag can be renamed, so what must survive is each tag's latest name: one of its newest versions'.
          const latest = new Map<string, { at: number; names: Set<string> }>();
          for (const row of [...fromA.tables.tags, ...fromB.tables.tags]) {
            const at = Number(row.updated_at);
            const name = `${row.kind}:${String(row.name).toLowerCase()}`;
            const seen = latest.get(String(row.id));
            if (!seen || at > seen.at) latest.set(String(row.id), { at, names: new Set([name]) });
            else if (at === seen.at) seen.names.add(name);
          }

          mergeBundle(a.db, fromB);
          mergeBundle(b.db, fromA);
          expect(dump(a.db)).toEqual(dump(b.db));

          const settled = dump(a.db);
          expect(mergeBundle(a.db, fromB).unchanged).toBe(true);
          expect(mergeBundle(b.db, fromA).unchanged).toBe(true);
          expect(dump(a.db)).toEqual(settled);
          // Every reference ends on a live setup or tag, and every merged-away one points at a live one.
          const liveIds = (table: "setups" | "tags") =>
            new Set(
              readTable(a.db, table)
                .filter((row) => row.deleted_at == null)
                .map((row) => row.id),
            );
          const setupIds = liveIds("setups");
          const tagIds = liveIds("tags");
          for (const row of readTable(a.db, "trades"))
            if (row.setup_id != null) expect(setupIds).toContain(row.setup_id);
          for (const row of readTable(a.db, "trade_tags")) expect(tagIds).toContain(row.tag_id);
          for (const table of ["setups", "tags"] as const) {
            const ids = liveIds(table);
            const into = new Map(readTable(a.db, table).map((row) => [row.id, row.merged_into]));
            for (const row of readTable(a.db, table)) {
              // A chain (merged into one later merged on) still ends on a live row.
              let target = row.merged_into;
              for (let hops = 0; target != null && !ids.has(target) && hops < 10; hops++)
                target = into.get(target) ?? null;
              if (row.merged_into != null) expect(ids).toContain(target);
            }
          }

          expect(new Set(readTable(a.db, "trades").map((row) => row.id))).toEqual(tradeIds);
          expect(new Set(readTable(a.db, "fills").map((row) => row.id))).toEqual(fillIds);
          expect(names(a, "setups")).toEqual(setupNames);
          const merged = names(a, "tags");
          for (const { names: candidates } of latest.values()) {
            expect([...candidates].some((name) => merged.has(name))).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
