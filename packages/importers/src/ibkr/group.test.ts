import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type FillForGrouping,
  fillIdFor,
  groupFills,
  legIdFor,
  type TradeCandidate,
  tradeIdFor,
} from "./group.js";
import { parseFlex } from "./parse.js";

const ACCOUNT = "DU1234567";
const OPTIONS = { account: ACCOUNT, book: "paper" as const };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** A statement's fills as stored, with the canceled one removed as the sync would (by trade id, size and price). */
function storedFills(name: string): FillForGrouping[] {
  const statement = parseFlex(fixture(name));
  const canceled = new Set<string>();
  for (const cancel of statement.cancels) {
    const hit = statement.fills
      .filter(
        (fill) =>
          fill.tradeId === cancel.tradeId && fill.quantity === cancel.quantity && fill.price === cancel.price,
      )
      .sort((a, b) => a.key.localeCompare(b.key))[0];
    if (hit) canceled.add(hit.key);
  }
  return statement.fills
    .filter((fill) => !canceled.has(fill.key))
    .map((fill) => ({ ...fill, id: fillIdFor(ACCOUNT, fill.key) }));
}

const leg = (candidate: TradeCandidate | undefined, right: string, strike: number) =>
  candidate?.trade.legs.find((each) => each.right === right && each.strike === strike);

describe("groupFills on the user's scalps (TJ Today, 2026-09-28)", () => {
  const { candidates, skipped } = groupFills(storedFills("today.xml"), OPTIONS);
  const nvda = candidates.find((each) => each.trade.underlying === "NVDA");
  const tsla = candidates.find((each) => each.trade.underlying === "TSLA");

  it("makes one scalp per round trip, scaled in and out", () => {
    expect(candidates).toHaveLength(2);
    expect(skipped).toEqual([]);
    expect(nvda?.trade).toMatchObject({
      strategy: "scalp",
      book: "paper",
      source: "ibkr_flex",
      structureLabel: "Long call",
      openedAt: Date.UTC(2026, 8, 28, 13, 31, 5),
      closedAt: Date.UTC(2026, 8, 28, 13, 46, 12),
      fees: 2.26,
      feesOpen: 0.93,
      feesClose: 1.33,
      netPnl: 44.74,
    });
    expect(nvda?.trade.legs).toHaveLength(1);
    expect(nvda?.trade.legs[0]).toMatchObject({
      right: "C",
      strike: 232.5,
      expiry: "2026-09-28",
      quantity: 2,
    });
    expect(nvda?.trade.legs[0]?.openPrice).toBeCloseTo(1.06, 10);
    expect(nvda?.trade.legs[0]?.closePrice).toBeCloseTo(1.295, 10);
  });

  it("nets TSLA's put +$300.55", () => {
    expect(tsla?.trade).toMatchObject({ structureLabel: "Long put", fees: 2.45, netPnl: 300.55 });
  });

  it("names each trade after its first opening fill, and each leg after its contract", () => {
    // Two NVDA buys in the same second: the smaller execution id comes first.
    expect(nvda?.id).toBe(tradeIdFor(ACCOUNT, "0000e242.6ab9e842.01.01"));
    expect(nvda?.legIds).toEqual([legIdFor(nvda?.id ?? "", "924107824")]);
  });
});

describe("groupFills on the Activity fixture", () => {
  const { candidates, skipped, links } = groupFills(storedFills("activity.xml"), OPTIONS);
  const aa = candidates.find((each) => each.trade.underlying === "AA");

  it("makes the AA fly, entered as eight single-leg orders in two lots, one iron fly", () => {
    expect(aa?.trade.strategy).toBe("iron_fly");
    expect(aa?.trade.structureLabel).toBe("Short Iron Butterfly");
    expect(aa?.trade.legs).toHaveLength(4);
    expect(leg(aa, "C", 47)).toMatchObject({ quantity: -2, openPrice: 1.37 });
    expect(leg(aa, "C", 47)?.closePrice).toBeCloseTo(0.325, 10);
    expect(leg(aa, "P", 47)?.openPrice).toBeCloseTo(1.49, 10);
    expect(leg(aa, "P", 47)).toMatchObject({ quantity: -2, closePrice: 2.14 });
    expect(leg(aa, "C", 54)).toMatchObject({ quantity: 2, closePrice: 0 });
    expect(leg(aa, "C", 54)?.openPrice).toBeCloseTo(0.13, 10);
    expect(leg(aa, "P", 40)).toMatchObject({ quantity: 2, openPrice: 0.08, closePrice: 0 });
  });

  it("agrees with oQuants on the structure and the credit, and takes IBKR's own P&L", () => {
    // oQuants: body 47, wings 40 / 54, 2 contracts, $2.65 credit (it rounds closes and books wings at 0.01).
    expect(aa?.trade.ironFly).toMatchObject({
      bodyPutStrike: 47,
      bodyCallStrike: 47,
      putWingStrike: 40,
      callWingStrike: 54,
      contracts: 2,
      netCost: -520.32,
    });
    expect(aa?.trade.ironFly?.creditPerShare).toBeCloseTo(2.65, 10);
    expect(aa?.trade).toMatchObject({ fees: 9.68, feesOpen: 6.32, feesClose: 3.36, netPnl: 27.32 });
  });

  it("closes the fly when the body was bought back, not when the untouched wings expired at 16:20", () => {
    expect(aa?.trade.openedAt).toBe(Date.UTC(2026, 6, 16, 17, 52, 42));
    expect(aa?.trade.closedAt).toBe(Date.UTC(2026, 6, 17, 13, 52, 10)); // 09:52:10 ET
  });

  it("links every AA fill to the fly and its leg", () => {
    const aaFills = storedFills("activity.xml").filter((fill) => fill.underlying === "AA");
    expect(aaFills).toHaveLength(14);
    for (const fill of aaFills) expect(links.get(fill.id)?.tradeId).toBe(aa?.id);
  });

  it("skips CLF, whose position was opened before the statement's first fill", () => {
    expect(skipped).toContainEqual(
      expect.objectContaining({
        reason: "before_start",
        ticker: "CLF",
        openedAt: Date.UTC(2026, 6, 24, 20, 20),
      }),
    );
  });

  it("makes CZR's call and put, both bought, two open scalps, the canceled fill left out", () => {
    const czr = candidates.filter((each) => each.trade.underlying === "CZR");
    expect(czr.map((each) => each.trade.structureLabel).sort()).toEqual(["Long call", "Long put"]);
    for (const scalp of czr) {
      expect(scalp.trade).toMatchObject({ strategy: "scalp", closedAt: null, netPnl: null });
      expect(scalp.trade.legs[0]).toMatchObject({ quantity: 2, closePrice: null });
    }
    expect(czr.find((each) => each.trade.legs[0]?.right === "C")?.trade.feesOpen).toBe(0);
  });

  it("gives the same ids however the fills arrive", () => {
    const shuffled = [...storedFills("activity.xml")].reverse();
    const again = groupFills(shuffled, OPTIONS);
    expect(again.candidates.map((each) => each.id).sort()).toEqual(candidates.map((each) => each.id).sort());
  });
});

let seq = 0;
/** A synthetic fill on XYZ 50C expiring 2026-10-16, one minute after the last. */
function fill(
  overrides: Partial<FillForGrouping> & Pick<FillForGrouping, "quantity" | "price">,
): FillForGrouping {
  seq++;
  const key = overrides.key ?? `x.${String(seq).padStart(5, "0")}`;
  return {
    id: `f-${key}`,
    key,
    conid: "1",
    underlying: "XYZ",
    right: "C",
    strike: 50,
    expiry: "2026-10-16",
    multiplier: 100,
    executedAt: Date.UTC(2026, 9, 1, 14, 0) + seq * 60_000,
    commission: 1,
    openClose: null,
    kind: "trade",
    ...overrides,
  };
}

describe("groupFills rules", () => {
  it("splits two round trips in one contract into two scalps", () => {
    const { candidates } = groupFills(
      [
        fill({ quantity: 1, price: 1 }),
        fill({ quantity: -1, price: 2 }),
        fill({ quantity: 1, price: 1 }),
        fill({ quantity: -1, price: 1.5 }),
      ],
      OPTIONS,
    );
    expect(candidates.map((each) => each.trade.netPnl)).toEqual([98, 48]);
  });

  it("keeps a scalp traded after a fly's body was bought back out of the fly, whose wings are still to expire", () => {
    const leg = (conid: string, right: "C" | "P", strike: number) => ({ conid, right, strike });
    const [c50, p50, c55, p45, c52] = [
      leg("c50", "C", 50),
      leg("p50", "P", 50),
      leg("c55", "C", 55),
      leg("p45", "P", 45),
      leg("c52", "C", 52),
    ];
    const { candidates, skipped } = groupFills(
      [
        fill({ ...c50, quantity: -1, price: 2 }),
        fill({ ...p50, quantity: -1, price: 2 }),
        fill({ ...c55, quantity: 1, price: 0.5 }),
        fill({ ...p45, quantity: 1, price: 0.5 }),
        // The body is bought back the next morning; the wings are left to expire.
        fill({ ...c50, quantity: 1, price: 1 }),
        fill({ ...p50, quantity: 1, price: 1 }),
        // A 0DTE scalp in the same expiry.
        fill({ ...c52, quantity: 1, price: 1 }),
        fill({ ...c52, quantity: -1, price: 1.5 }),
        // The wings expire at 16:20.
        fill({ ...c55, quantity: -1, price: 0, kind: "expiration" }),
        fill({ ...p45, quantity: -1, price: 0, kind: "expiration" }),
      ],
      OPTIONS,
    );
    expect(skipped).toEqual([]);
    expect(candidates.map((each) => [each.trade.strategy, each.trade.legs.length])).toEqual([
      ["iron_fly", 4],
      ["scalp", 1],
    ]);
  });

  it("closes a scalp when a sale takes the position through zero, and leaves the short it opened out", () => {
    const buy = fill({ quantity: 1, price: 1, commission: 0.65 });
    const sale = fill({ quantity: -2, price: 2, commission: 1.3 });
    const { candidates, skipped, links } = groupFills([buy, sale], OPTIONS);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.trade).toMatchObject({
      strategy: "scalp",
      closedAt: sale.executedAt,
      netPnl: 98.7,
      feesOpen: 0.65,
      feesClose: 0.65,
    });
    expect(candidates[0]?.trade.legs[0]).toMatchObject({ quantity: 1, openPrice: 1, closePrice: 2 });
    // The short one contract left over was sold to open, which no rule makes a trade of.
    expect(skipped).toEqual([expect.objectContaining({ reason: "unrecognised", openedAt: sale.executedAt })]);
    // The fill itself shows on the scalp it closed.
    expect(links.get(sale.id)?.tradeId).toBe(candidates[0]?.id);
    expect([...links.keys()].sort()).toEqual([buy.id, sale.id].sort());
  });

  it("splits a scalp from a later short in the same contract while another contract holds the episode open", () => {
    const put = { conid: "2", right: "P" as const, strike: 45 };
    const { candidates, skipped } = groupFills(
      [
        fill({ ...put, quantity: 1, price: 1 }),
        fill({ quantity: 1, price: 1 }),
        fill({ quantity: -2, price: 1.5 }),
        fill({ quantity: 1, price: 1.25 }),
        fill({ ...put, quantity: -1, price: 2 }),
      ],
      OPTIONS,
    );
    expect(candidates.map((each) => [each.trade.structureLabel, each.trade.legs[0]?.quantity])).toEqual([
      ["Long put", 1],
      ["Long call", 1],
    ]);
    expect(skipped.map((each) => each.reason)).toEqual(["unrecognised"]);
  });

  it("skips a fly whose short leg was bought back past zero, rather than build a leg from both sides", () => {
    const leg = (conid: string, right: "C" | "P", strike: number) => ({ conid, right, strike });
    const [c50, p50, c55, p45] = [
      leg("c50", "C", 50),
      leg("p50", "P", 50),
      leg("c55", "C", 55),
      leg("p45", "P", 45),
    ];
    const { candidates, skipped } = groupFills(
      [
        fill({ ...c50, quantity: -1, price: 2 }),
        fill({ ...p50, quantity: -1, price: 2 }),
        fill({ ...c55, quantity: 1, price: 0.5 }),
        fill({ ...p45, quantity: 1, price: 0.5 }),
        fill({ ...c50, quantity: 2, price: 1 }),
        fill({ ...p50, quantity: 1, price: 1 }),
        fill({ ...c50, quantity: -1, price: 0, kind: "expiration" }),
        fill({ ...c55, quantity: -1, price: 0, kind: "expiration" }),
        fill({ ...p45, quantity: -1, price: 0, kind: "expiration" }),
      ],
      OPTIONS,
    );
    expect(candidates).toEqual([]);
    expect(skipped.map((each) => each.reason)).toEqual(["unrecognised"]);
  });

  it("keeps a bought contract that hasn't been sold as an open scalp", () => {
    const { candidates } = groupFills([fill({ quantity: 3, price: 2 })], OPTIONS);
    expect(candidates[0]?.trade).toMatchObject({ closedAt: null, netPnl: null });
  });

  it("skips a structure that isn't an iron fly, such as a short strangle", () => {
    const { candidates, skipped } = groupFills(
      [
        fill({ conid: "c", right: "C", strike: 55, quantity: -1, price: 1 }),
        fill({ conid: "p", right: "P", strike: 45, quantity: -1, price: 1 }),
      ],
      OPTIONS,
    );
    expect(candidates).toEqual([]);
    expect(skipped).toEqual([expect.objectContaining({ reason: "unrecognised", ticker: "XYZ" })]);
  });

  it("adds the fees from their rounded parts, as the forms do, so re-saving a trade can't move them by a cent", () => {
    // 0.006 + 0.006 is 0.01 as a total, but 0.01 + 0.01 as parts. The forms add the parts.
    const { candidates } = groupFills(
      [
        fill({ quantity: 1, price: 1, commission: 0.006 }),
        fill({ quantity: -1, price: 1.5, commission: 0.006 }),
      ],
      OPTIONS,
    );
    expect(candidates[0]?.trade).toMatchObject({
      feesOpen: 0.01,
      feesClose: 0.01,
      fees: 0.02,
      netPnl: 49.98,
    });
  });

  it("puts every fill in exactly one trade, and the trades' P&L adds up to the fills' cash (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            lots: fc.integer({ min: 1, max: 5 }),
            buy: fc.integer({ min: 5, max: 1_000 }),
            sell: fc.integer({ min: 0, max: 2_000 }),
            fee: fc.integer({ min: 0, max: 300 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (trips) => {
          const fills = trips.flatMap((trip) => [
            fill({ quantity: trip.lots, price: trip.buy / 100, commission: trip.fee / 100 }),
            fill({ quantity: -trip.lots, price: trip.sell / 100, commission: trip.fee / 100 }),
          ]);
          const { candidates, links } = groupFills(fills, OPTIONS);
          expect(candidates).toHaveLength(trips.length);
          expect(fills.every((each) => links.has(each.id))).toBe(true);
          const total = candidates.reduce((sum, each) => sum + (each.trade.netPnl ?? 0), 0);
          const cash = trips.reduce(
            (sum, trip) => sum + trip.lots * (trip.sell - trip.buy) - (2 * trip.fee) / 100,
            0,
          );
          // positionCash rounds the gross, the fees and the net to cents: at most 1.5 cents per trade.
          expect(Math.abs(total - cash)).toBeLessThanOrEqual(0.02 * trips.length);
        },
      ),
    );
  });
});
