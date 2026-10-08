import { holdRange, newTradeSchema, nyDate, type PriceBar, stockAt } from "@tj/core";
import { createBarsRepo, createTaxonomyRepo, createTradesRepo, type Db } from "@tj/db";
import type { FlyPlan } from "./flies.js";
import { cents } from "./prices.js";
import type { ScalpPlan } from "./scalps.js";
import { symbolInfo } from "./symbols.js";

/** Bars to store, a symbol (or contract) and timeframe at a time, every known day listed, empty ones too. */
export type DemoBars = {
  symbol: string;
  timeframe: "1m" | "1d";
  days: { date: string; bars: PriceBar[] }[];
}[];

const MINUTE_MS = 60_000;

/** The minute bar holding `at`. */
function barHolding(bars: readonly PriceBar[], at: number): PriceBar {
  const minute = Math.floor(at / MINUTE_MS) * MINUTE_MS;
  const bar = bars.find((each) => each.t === minute);
  if (!bar) throw new Error(`no bar at ${new Date(at).toISOString()}`);
  return bar;
}

/**
 * Writes the demo through the journal's own repositories, in one transaction (demo spec §3.4): the bars, the seeded
 * setups and tags, then each trade in time order with the clock just after its close, its levels, and the prices the
 * server's fillers would fetch. A trade a repository refuses fails the whole run, naming the trade.
 */
export function writeDemo(
  db: Db,
  input: {
    scalps: readonly ScalpPlan[];
    flies: readonly FlyPlan[];
    bars: DemoBars;
    minutesOf: (symbol: string, date: string) => PriceBar[];
    now: () => number;
    /** Minutes after a trade's close that it's written down, by a key of its own. */
    jitter: (key: string) => number;
  },
): number {
  const plans = [
    ...input.scalps.map((plan) => ({ kind: "scalp" as const, plan })),
    ...input.flies.map((plan) => ({ kind: "fly" as const, plan })),
  ].sort((a, b) => a.plan.openedAt - b.plan.openedAt);
  let clock = (plans[0]?.plan.openedAt ?? input.now()) - 86_400_000;
  const tick = () => clock;
  const trades = createTradesRepo(db, tick);
  const taxonomy = createTaxonomyRepo(db, tick);
  const barsRepo = createBarsRepo(db);
  let stored = 0;

  db.$client.transaction(() => {
    for (const entry of input.bars) {
      barsRepo.store(entry.symbol, entry.timeframe, entry.days, input.now());
      for (const day of entry.days) stored += day.bars.length;
    }
    taxonomy.seedDefaults();
    const setups = new Map(taxonomy.listSetups().map((setup) => [setup.name, setup.id]));
    const tags = new Map(taxonomy.listTags().map((tag) => [tag.name, tag.id]));
    const tagIds = (names: readonly string[]) =>
      names.map((name) => tags.get(name)).filter((id): id is string => id !== undefined);

    for (const { kind, plan } of plans) {
      clock = plan.closedAt + input.jitter(`${plan.symbol}:${plan.openedAt}:written`) * MINUTE_MS;
      try {
        const feesOpen = cents(plan.fees / 2);
        const common = {
          book: plan.book,
          underlying: plan.symbol,
          underlyingName: symbolInfo(plan.symbol).name,
          openedAt: plan.openedAt,
          closedAt: plan.closedAt,
          netPnl: plan.netPnl,
          fees: plan.fees,
          feesOpen,
          feesClose: cents(plan.fees - feesOpen),
          notes: plan.notes,
          grade: plan.grade,
          source: "manual" as const,
          setupId: plan.setup ? (setups.get(plan.setup) ?? null) : null,
          tagIds: tagIds(plan.tags),
        };
        const minutes = (at: number) => input.minutesOf(plan.symbol, nyDate(at));
        if (kind === "scalp") {
          const scalp = plan as ScalpPlan;
          const trade = trades.create(
            newTradeSchema.parse({
              ...common,
              strategy: "scalp",
              structureLabel: scalp.right === "C" ? "Long call" : "Long put",
              legs: [
                {
                  right: scalp.right,
                  strike: scalp.strike,
                  expiry: scalp.expiry,
                  quantity: scalp.contracts,
                  openPrice: scalp.openPrice,
                  closePrice: scalp.closePrice,
                },
              ],
            }),
          );
          trades.update(trade.id, {
            scalp: { levelBasis: scalp.stop.basis, stopPrice: scalp.stop.price, targets: scalp.targets },
          });
          const day = minutes(scalp.openedAt);
          const hold = holdRange(day, scalp.openedAt, scalp.closedAt, true);
          const option = holdRange(scalp.optionBars, scalp.openedAt, scalp.closedAt, true);
          trades.setScalpPrices(
            trade.id,
            {
              entryPrice: cents(stockAt(barHolding(day, scalp.openedAt), scalp.openedAt)),
              holdHigh: hold?.high ?? null,
              holdLow: hold?.low ?? null,
              optionHigh: option?.high ?? null,
              optionLow: option?.low ?? null,
            },
            clock,
          );
        } else {
          const fly = plan as FlyPlan;
          const trade = trades.create(
            newTradeSchema.parse({
              ...common,
              strategy: "iron_fly",
              structureLabel: "Iron fly",
              legs: fly.legs,
              ironFly: {
                bodyPutStrike: fly.bodyStrike,
                bodyCallStrike: fly.bodyStrike,
                putWingStrike: fly.putWing,
                callWingStrike: fly.callWing,
                contracts: fly.contracts,
                creditPerShare: fly.creditPerShare,
                netCost: fly.netCost,
                earningsDate: fly.earningsDate,
                earningsTiming: fly.earningsTiming,
                // Moves and IVs are left for the app to work out from the legs and stock prices, as a synced fly's
                // are: typed in, they would read as the user's own overrides.
              },
            }),
          );
          const at = (time: number) => cents(stockAt(barHolding(minutes(time), time), time));
          trades.setUnderlyingPrice(trade.id, "entry", at(fly.openedAt));
          trades.setUnderlyingPrice(trade.id, "exit", at(fly.closedAt));
        }
      } catch (error) {
        throw new Error(
          `demo trade refused: ${plan.symbol} ${new Date(plan.openedAt).toISOString()}: ${(error as Error).message}`,
        );
      }
    }
  })();
  return stored;
}
