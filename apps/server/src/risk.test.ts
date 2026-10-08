import { nyWallClock, type PriceBar } from "@tj/core";
import { AlpacaError, type BarHistory, type OptionBarHistory } from "@tj/market-data";
import { describe, expect, it, vi } from "vitest";
import { createMarketData } from "./marketData.js";
import { fakeSources, LOCAL, testApp } from "./testing.js";

const JSON_HEADERS = { "content-type": "application/json", ...LOCAL };
const NOW = Date.UTC(2026, 8, 29, 18, 0); // Tue Sep 29, 14:00 ET
const OPENED = Date.UTC(2026, 8, 28, 13, 31, 5); // Mon Sep 28, 09:31:05 ET
const CLOSED = Date.UTC(2026, 8, 28, 13, 46, 12); // 09:46:12 ET
const DAY = 86_400_000;

const bar = (date: string, minute: number, o: number, h: number, l: number, c: number): PriceBar => ({
  t: nyWallClock(date, minute),
  o,
  h,
  l,
  c,
  v: 100,
});
/** Sep 28 around the scalp: the minute before, its entry bar (09:31), the high at 09:40, the exit minute, and after. */
const SEP_28 = [
  bar("2026-09-28", 570, 230.5, 231, 230.2, 230.78),
  bar("2026-09-28", 571, 230.78, 232.11, 230.71, 231.355),
  bar("2026-09-28", 580, 232.5, 233.21, 232.4, 233),
  bar("2026-09-28", 586, 232.6, 232.9, 232.2, 232.3),
  bar("2026-09-28", 587, 232.3, 245, 210, 232),
];
/** The contract's minutes around the same hold: high 1.53 at the entry minute, low 0.64 at the exit minute. */
const OPTION_SEP_28 = [
  bar("2026-09-28", 570, 0.9, 1, 0.85, 0.95),
  bar("2026-09-28", 571, 0.97, 1.53, 0.97, 1.1),
  bar("2026-09-28", 580, 1.2, 1.37, 1.15, 1.3),
  bar("2026-09-28", 586, 1.1, 1.32, 0.64, 1.29),
  bar("2026-09-28", 587, 1.29, 3, 0.1, 1.2),
];

interface FillBody {
  filled: number;
  missing: { tradeId: string; reason: string }[];
  optionMissing: { tradeId: string; reason: string }[];
  unavailable: { reason: string; message: string } | null;
}
interface RiskView {
  id: string;
  strategy: string;
  scalpPrices: {
    entryPrice: number | null;
    holdHigh: number | null;
    holdLow: number | null;
    optionHigh: number | null;
    optionLow: number | null;
  } | null;
  risk: {
    problem: string | null;
    plannedRisk: number | null;
    r: number | null;
    rewardRisk: number | null;
    mae: { move: number; r: number | null } | null;
  } | null;
}

/** The Sep 28 NVDA 232.5C scalp as POST /api/trades takes it. */
const nvda = (overrides: Record<string, unknown> = {}) => ({
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  structureLabel: "Long call",
  openedAt: OPENED,
  closedAt: CLOSED,
  netPnl: 44.74,
  fees: 2.26,
  legs: [
    { right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2, openPrice: 1.06, closePrice: 1.295 },
  ],
  ...overrides,
});

const fly = {
  strategy: "iron_fly",
  book: "paper",
  underlying: "AA",
  openedAt: OPENED,
  closedAt: CLOSED,
  netPnl: 10,
  fees: 1,
  legs: [],
  ironFly: {
    bodyPutStrike: 47,
    bodyCallStrike: 47,
    putWingStrike: 40,
    callWingStrike: 54,
    contracts: 2,
    creditPerShare: 2.5,
  },
};

/** The app over fake Alpaca minute bars, the stock's and the contract's; `null` sets up no key. */
function setup(
  history: Partial<BarHistory> | null = {},
  options: OptionBarHistory["minuteBars"] = async () => OPTION_SEP_28,
) {
  const minuteBars = vi.fn(history?.minuteBars ?? (async () => SEP_28));
  const optionBars = vi.fn(options);
  const market = history
    ? createMarketData(
        { keyId: "PKTEST", secretKey: "s" },
        {
          build: () =>
            fakeSources({
              history: { minuteBars, dailyBars: async () => [] },
              optionHistory: { minuteBars: optionBars },
            }),
          log: () => {},
        },
      )
    : undefined;
  const app = testApp({ market, now: () => NOW });
  const send = (method: string, path: string, body: unknown) =>
    app.request(path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
  return {
    minuteBars,
    optionBars,
    async create(body: Record<string, unknown> = nvda()) {
      return ((await (await send("POST", "/api/trades", body)).json()) as { id: string }).id;
    },
    patch: (id: string, body: unknown) => send("PATCH", `/api/trades/${id}`, body),
    async fill(tradeIds?: string[]) {
      const res = await send("POST", "/api/risk/fill", tradeIds ? { tradeIds } : {});
      return { status: res.status, body: (await res.json()) as FillBody };
    },
    async trade(id: string) {
      return (await (await app.request(`/api/trades/${id}`, { headers: LOCAL })).json()) as RiskView;
    },
    async list() {
      return (await (await app.request("/api/trades", { headers: LOCAL })).json()) as RiskView[];
    },
  };
}

describe("POST /api/risk/fill", () => {
  it("fills the stock at entry, by the second, and the hold's range; the trade then carries its R", async () => {
    const app = setup();
    const id = await app.create();
    expect((await app.fill([id])).body).toEqual({
      filled: 1,
      missing: [],
      optionMissing: [],
      unavailable: null,
    });
    expect(app.minuteBars).toHaveBeenCalledWith(
      "NVDA",
      nyWallClock("2026-09-28", 0),
      nyWallClock("2026-09-29", 0),
    );
    const filled = await app.trade(id);
    expect(filled.scalpPrices?.entryPrice).toBeCloseTo(230.828, 3);
    expect(filled.scalpPrices).toMatchObject({ holdHigh: 233.21, holdLow: 230.71 });

    await app.patch(id, {
      scalp: {
        levelBasis: "stock",
        stopPrice: 229,
        targets: [
          { price: 233, contracts: 1 },
          { price: 234.5, contracts: 1 },
        ],
      },
    });
    const { risk } = await app.trade(id);
    expect(risk).toMatchObject({ problem: null, plannedRisk: 104.05, mae: { move: 0.12 } });
    expect(risk?.r).toBeCloseTo(0.43, 3);
    expect(risk?.rewardRisk).toBeCloseTo(2.77, 2);
  });

  it("has nothing to do the second time, and asks Alpaca for nothing more", async () => {
    const app = setup();
    const id = await app.create();
    await app.fill([id]);
    expect((await app.fill()).body).toEqual({ filled: 0, missing: [], optionMissing: [], unavailable: null });
    expect(app.minuteBars).toHaveBeenCalledTimes(1);
  });

  it("reads only an open scalp's entry day, and leaves its range for the close", async () => {
    const app = setup();
    const id = await app.create(nvda({ closedAt: null, netPnl: null }));
    expect((await app.fill([id])).body).toEqual({
      filled: 1,
      missing: [],
      optionMissing: [],
      unavailable: null,
    });
    // One request, for Sep 28: today (Sep 29) would be a second.
    expect(app.minuteBars).toHaveBeenCalledTimes(1);
    expect((await app.trade(id)).scalpPrices).toMatchObject({ holdHigh: null, holdLow: null });
    expect((await app.fill()).body.filled).toBe(0);
  });

  it("leaves a scalp from the last 16 minutes for later, reading nothing", async () => {
    const app = setup();
    const id = await app.create(nvda({ openedAt: NOW - 10 * 60_000, closedAt: null, netPnl: null }));
    expect((await app.fill([id])).body).toEqual({
      filled: 0,
      missing: [{ tradeId: id, reason: "too_recent" }],
      optionMissing: [],
      unavailable: null,
    });
    expect(app.minuteBars).not.toHaveBeenCalled();
  });

  it("stores the entry of a scalp closed in the last 16 minutes, and says its range is too recent", async () => {
    const app = setup({ minuteBars: async () => [bar("2026-09-29", 780, 231, 231.5, 230.9, 231.2)] });
    const id = await app.create(
      nvda({ openedAt: nyWallClock("2026-09-29", 780) + 30_000, closedAt: NOW - 5 * 60_000 }),
    );
    expect((await app.fill([id])).body).toEqual({
      filled: 1,
      missing: [{ tradeId: id, reason: "too_recent" }],
      optionMissing: [{ tradeId: id, reason: "too_recent" }],
      unavailable: null,
    });
    expect((await app.trade(id)).scalpPrices?.entryPrice).toBeCloseTo(231.1, 6);
  });

  it("says a thin name's range is too recent, not missing, while today's bars are still coming", async () => {
    // Closed at 13:20 today; nothing has traded since 13:00, and the day isn't over, so a later bar may yet come.
    const app = setup({ minuteBars: async () => [bar("2026-09-29", 780, 231, 231.5, 230.9, 231.2)] });
    const id = await app.create(
      nvda({ openedAt: nyWallClock("2026-09-29", 780) + 30_000, closedAt: nyWallClock("2026-09-29", 800) }),
    );
    expect((await app.fill([id])).body).toEqual({
      filled: 1,
      missing: [{ tradeId: id, reason: "too_recent" }],
      optionMissing: [{ tradeId: id, reason: "too_recent" }],
      unavailable: null,
    });
  });

  it("says when Alpaca has no bar for the entry minute, keeping the range it found", async () => {
    const app = setup({
      minuteBars: async () => SEP_28.filter((each) => each.t !== nyWallClock("2026-09-28", 571)),
    });
    const id = await app.create();
    expect((await app.fill([id])).body).toEqual({
      filled: 1,
      missing: [{ tradeId: id, reason: "no_bars" }],
      optionMissing: [],
      unavailable: null,
    });
    expect((await app.trade(id)).scalpPrices).toMatchObject({
      entryPrice: null,
      holdHigh: 233.21,
      holdLow: 232.2,
    });
  });

  it("takes a finished day's range even when no trade reaches the exit minute", async () => {
    // A thin name: nothing trades at or after 09:46 on Sep 28, and the day is long over.
    const app = setup({ minuteBars: async () => SEP_28.slice(0, 3) });
    const id = await app.create();
    expect((await app.fill([id])).body).toEqual({
      filled: 1,
      missing: [],
      optionMissing: [],
      unavailable: null,
    });
    expect((await app.trade(id)).scalpPrices).toMatchObject({ holdHigh: 233.21, holdLow: 230.71 });
  });

  it("answers no_key without a key", async () => {
    const app = setup(null);
    const id = await app.create();
    expect((await app.fill([id])).body).toEqual({
      filled: 0,
      missing: [],
      optionMissing: [],
      unavailable: { reason: "no_key", message: "Add an Alpaca key in Settings to fetch the stock price." },
    });
  });

  it("stops at Alpaca's first failure and says so", async () => {
    const app = setup({
      minuteBars: async () => {
        throw new AlpacaError(502, "");
      },
    });
    await app.create();
    await app.create(nvda({ openedAt: OPENED - 3 * DAY, closedAt: CLOSED - 3 * DAY }));
    expect((await app.fill()).body).toEqual({
      filled: 0,
      missing: [],
      optionMissing: [],
      unavailable: { reason: "unreachable", message: "Alpaca didn't answer. Reopen the trade to try again." },
    });
    expect(app.minuteBars).toHaveBeenCalledTimes(1);
  });

  it("fills scalps only, leaving flies to the move filler", async () => {
    const app = setup();
    await app.create(fly);
    expect((await app.fill()).body).toEqual({ filled: 0, missing: [], optionMissing: [], unavailable: null });
    expect(app.minuteBars).not.toHaveBeenCalled();
  });

  it("drops prices read for a time the user moved while Alpaca answered", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = setup({
      minuteBars: async () => {
        await hold;
        return SEP_28;
      },
    });
    const id = await app.create();
    const run = app.fill([id]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await app.patch(id, { openedAt: OPENED + 120_000 });
    release();
    expect((await run).body.filled).toBe(0);
    expect((await app.trade(id)).scalpPrices).toBeNull();
  });

  it("stores each closed scalp's option range beside the stock's", async () => {
    const app = setup();
    const id = await app.create();
    expect((await app.fill([id])).body).toMatchObject({ filled: 1, missing: [], optionMissing: [] });
    expect(app.optionBars).toHaveBeenCalledWith(
      "NVDA260928C00232500",
      nyWallClock("2026-09-28", 0),
      nyWallClock("2026-09-29", 0),
    );
    expect((await app.trade(id)).scalpPrices).toMatchObject({ optionHigh: 1.53, optionLow: 0.64 });
  });

  it("fetches only the option range when the stock's is stored, and keeps going without it when Alpaca fails", async () => {
    let up = false;
    const app = setup({}, async () => {
      if (!up) throw new AlpacaError(500, "");
      return OPTION_SEP_28;
    });
    const first = await app.create();
    const second = await app.create(nvda({ openedAt: OPENED + 60_000 }));
    const body = (await app.fill()).body;
    expect(body.filled).toBe(2);
    expect(body.optionMissing).toEqual([
      { tradeId: first, reason: "unreachable" },
      { tradeId: second, reason: "unreachable" },
    ]);
    // One failed option request ends the run's option fetching.
    expect(app.optionBars).toHaveBeenCalledTimes(1);
    expect((await app.trade(first)).scalpPrices).toMatchObject({
      entryPrice: expect.any(Number),
      optionHigh: null,
    });

    up = true;
    const stockCalls = app.minuteBars.mock.calls.length;
    expect((await app.fill([first])).body).toMatchObject({ filled: 1, optionMissing: [] });
    expect(app.minuteBars).toHaveBeenCalledTimes(stockCalls);
    expect((await app.trade(first)).scalpPrices).toMatchObject({ optionHigh: 1.53, optionLow: 0.64 });
  });

  it("waits for Alpaca's delay without asking, and asks nothing before its option history", async () => {
    const app = setup();
    const recent = await app.create(nvda({ openedAt: NOW - 20 * 60_000, closedAt: NOW - 10 * 60_000 }));
    expect((await app.fill([recent])).body.optionMissing).toEqual([
      { tradeId: recent, reason: "too_recent" },
    ]);
    const old = await app.create(
      nvda({
        openedAt: Date.UTC(2023, 11, 15, 15),
        closedAt: Date.UTC(2023, 11, 15, 15, 10),
        legs: [{ right: "C", strike: 470, expiry: "2023-12-15", quantity: 1, openPrice: 1, closePrice: 1.2 }],
      }),
    );
    expect((await app.fill([old])).body.optionMissing).toEqual([]);
    expect(app.optionBars).not.toHaveBeenCalled();
  });

  it("calls a finished hold with no option bars no_bars", async () => {
    const app = setup({}, async () => []);
    const id = await app.create();
    expect((await app.fill([id])).body.optionMissing).toEqual([{ tradeId: id, reason: "no_bars" }]);
  });

  it("drops an option range fetched while the contract was edited", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = setup({}, async () => {
      await hold;
      return OPTION_SEP_28;
    });
    const id = await app.create();
    const run = app.fill([id]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await app.patch(id, {
      legs: [
        { right: "C", strike: 235, expiry: "2026-09-28", quantity: 2, openPrice: 1.06, closePrice: 1.295 },
      ],
    });
    release();
    expect((await run).body.filled).toBe(0);
    expect((await app.trade(id)).scalpPrices).toBeNull();
  });

  it("refuses a body that isn't a list of trade ids", async () => {
    expect((await setup().fill(["not-a-uuid"])).status).toBe(400);
  });
});

describe("risk on every trade", () => {
  it("gives a scalp its model, and a fly null", async () => {
    const app = setup();
    const id = await app.create();
    await app.create(fly);
    const trades = await app.list();
    expect(trades.find((trade) => trade.id === id)?.risk).toMatchObject({
      problem: "no_stop",
      plannedRisk: null,
    });
    expect(trades.find((trade) => trade.strategy === "iron_fly")?.risk).toBeNull();
  });

  it("refuses targets that trim more than the position, saying why", async () => {
    const app = setup();
    const id = await app.create();
    const res = await app.patch(id, {
      scalp: {
        levelBasis: "stock",
        targets: [
          { price: 233, contracts: 2 },
          { price: 234.5, contracts: 1 },
        ],
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid",
      message: "The targets trim 3 contracts; the position has 2.",
    });
  });
});
