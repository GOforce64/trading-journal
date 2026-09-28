import { AlpacaError, type BarSource } from "@tj/market-data";
import { describe, expect, it } from "vitest";
import { createMarketData } from "./marketData.js";
import { fakeSources, LOCAL, testApp } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
const JSON_HEADERS = { "content-type": "application/json", ...LOCAL };
const OPEN = Date.UTC(2026, 8, 9, 19, 54); // Wed Sep 9, 15:54 ET
const CLOSE = Date.UTC(2026, 8, 10, 19, 44); // Thu Sep 10, 15:44 ET
const NOW = Date.UTC(2026, 8, 28, 16, 0);
const iso = (ms: number) => new Date(ms).toISOString();

interface FillBody {
  filled: number;
  missing: { tradeId: string; underlying: string; side: string; reason: string }[];
  unavailable: { reason: string; message: string } | null;
}

/** The M fly as POST /api/trades takes it. */
const fly = (overrides: Record<string, unknown> = {}) => ({
  strategy: "iron_fly",
  book: "paper",
  underlying: "M",
  openedAt: OPEN,
  closedAt: CLOSE,
  netPnl: 224.06,
  fees: 10.94,
  legs: [],
  ironFly: {
    bodyPutStrike: 21.5,
    bodyCallStrike: 21.5,
    putWingStrike: 18,
    callWingStrike: 27,
    contracts: 5,
    creditPerShare: 1.55,
  },
  ...overrides,
});

const M_PRICES = { [`M@${iso(OPEN)}`]: 21.66, [`M@${iso(CLOSE)}`]: 20.505 };

/** Answers each price from `prices`, keyed "SYMBOL@ISO moment", and records what was asked. With `hold`, answers wait for it. */
function fakeBars(prices: Record<string, number | Error> = {}, hold?: Promise<void>) {
  const asked: string[] = [];
  const bars: BarSource = {
    async priceAt(symbol, at) {
      const key = `${symbol}@${iso(at)}`;
      asked.push(key);
      await hold;
      const answer = prices[key];
      if (answer instanceof Error) throw answer;
      return answer ?? null;
    },
    closeOn: async () => null,
  };
  return { bars, asked };
}

function setup(bars: BarSource | null, now = NOW) {
  const market = bars
    ? createMarketData(KEYS, { build: () => fakeSources({ bars }), log: () => {} })
    : undefined;
  const app = testApp({ market, now: () => now });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  return {
    market,
    async create(body: Record<string, unknown> = fly()) {
      return ((await (await post("/api/trades", body)).json()) as { id: string }).id;
    },
    async patch(id: string, body: unknown) {
      const res = await app.request(`/api/trades/${id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
    },
    async fill(body: unknown = {}) {
      const res = await post("/api/moves/fill", body);
      return { status: res.status, body: (await res.json()) as FillBody };
    },
    async prices(id: string) {
      const res = await app.request(`/api/trades/${id}`, { headers: LOCAL });
      const trade = (await res.json()) as {
        ironFly: { underlyingPriceEntry: number | null; underlyingPriceExit: number | null };
      };
      return [trade.ironFly.underlyingPriceEntry, trade.ironFly.underlyingPriceExit];
    },
  };
}

describe("POST /api/moves/fill", () => {
  it("fills both prices of a closed fly, read at its session moments", async () => {
    const { bars, asked } = fakeBars(M_PRICES);
    const app = setup(bars);
    const id = await app.create();
    expect(await app.fill()).toEqual({ status: 200, body: { filled: 2, missing: [], unavailable: null } });
    expect(asked).toEqual([`M@${iso(OPEN)}`, `M@${iso(CLOSE)}`]);
    expect(await app.prices(id)).toEqual([21.66, 20.505]);
  });

  it("fills only the trades it is given", async () => {
    const { bars, asked } = fakeBars(M_PRICES);
    const app = setup(bars);
    const id = await app.create();
    await app.create(fly({ underlying: "ABC" }));
    await app.fill({ tradeIds: [id] });
    expect(asked).toEqual([`M@${iso(OPEN)}`, `M@${iso(CLOSE)}`]);
  });

  it("fills an open fly's entry price, and asks for no exit price", async () => {
    const { bars, asked } = fakeBars(M_PRICES);
    const app = setup(bars);
    const id = await app.create(fly({ closedAt: null, netPnl: null }));
    expect((await app.fill()).body.filled).toBe(1);
    expect(asked).toEqual([`M@${iso(OPEN)}`]);
    expect(await app.prices(id)).toEqual([21.66, null]);
  });

  it("never asks again for a price it has", async () => {
    const { bars, asked } = fakeBars(M_PRICES);
    const app = setup(bars);
    await app.create();
    await app.fill();
    expect((await app.fill()).body).toEqual({ filled: 0, missing: [], unavailable: null });
    expect(asked).toHaveLength(2);
  });

  it("reads a time outside market hours at the session's edge", async () => {
    const { bars, asked } = fakeBars();
    const app = setup(bars);
    // CRM's stored open: 18:11 ET.
    await app.create(fly({ openedAt: Date.UTC(2026, 7, 26, 22, 11), closedAt: null, netPnl: null }));
    await app.fill();
    expect(asked).toEqual([`M@${iso(Date.UTC(2026, 7, 26, 20, 0))}`]); // 16:00 ET
  });

  it("skips a time on a day the market was shut", async () => {
    const { bars, asked } = fakeBars();
    const app = setup(bars);
    const saturday = Date.UTC(2026, 8, 12, 15, 0);
    const id = await app.create(fly({ openedAt: saturday, closedAt: null, netPnl: null }));
    expect((await app.fill()).body.missing).toEqual([
      { tradeId: id, underlying: "M", side: "entry", reason: "no_session" },
    ]);
    expect(asked).toEqual([]);
  });

  it("leaves a price from the last 16 minutes for later", async () => {
    const { bars, asked } = fakeBars(M_PRICES);
    const app = setup(bars, CLOSE + 10 * 60_000);
    const id = await app.create();
    expect((await app.fill()).body).toEqual({
      filled: 1,
      missing: [{ tradeId: id, underlying: "M", side: "exit", reason: "too_recent" }],
      unavailable: null,
    });
    expect(asked).toEqual([`M@${iso(OPEN)}`]);
  });

  it("says when Alpaca has no price", async () => {
    const { bars } = fakeBars();
    const app = setup(bars);
    const id = await app.create();
    expect((await app.fill()).body.missing).toEqual([
      { tradeId: id, underlying: "M", side: "entry", reason: "no_bars" },
      { tradeId: id, underlying: "M", side: "exit", reason: "no_bars" },
    ]);
  });

  it("stops at the first error, keeps what it wrote, and reports the failure", async () => {
    const { bars, asked } = fakeBars({
      [`M@${iso(OPEN)}`]: 21.66,
      [`M@${iso(CLOSE)}`]: new AlpacaError(401, "request is not authorized"),
    });
    const app = setup(bars);
    const first = await app.create();
    await app.create(fly({ openedAt: OPEN + 86_400_000, closedAt: null, netPnl: null }));
    expect((await app.fill()).body).toEqual({
      filled: 1,
      missing: [],
      unavailable: {
        reason: "unreachable",
        message: "Alpaca didn't answer. Try Fill in missing again in a moment.",
      },
    });
    expect(asked).toHaveLength(2);
    expect(await app.prices(first)).toEqual([21.66, null]);
    expect(app.market?.status().state).toBe("error");
  });

  it("answers no_key without a market data key", async () => {
    const app = setup(null);
    await app.create();
    expect((await app.fill()).body).toEqual({
      filled: 0,
      missing: [],
      unavailable: { reason: "no_key", message: "Add an Alpaca key in Settings to fetch stock prices." },
    });
  });

  it("runs one fill at a time, so two at once fetch each price once", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { bars, asked } = fakeBars(M_PRICES, hold);
    const app = setup(bars);
    await app.create();
    const both = Promise.all([app.fill(), app.fill()]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The second run waits behind the first, which is waiting on Alpaca.
    expect(asked).toHaveLength(1);
    release();
    const [first, second] = await both;
    expect(first.body.filled + second.body.filled).toBe(2);
    expect(asked).toHaveLength(2);
  });

  it("drops a price whose time or ticker changed while Alpaca was answering", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { bars, asked } = fakeBars(M_PRICES, hold);
    const app = setup(bars);
    const id = await app.create(fly({ closedAt: null, netPnl: null }));
    const run = app.fill();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toEqual([`M@${iso(OPEN)}`]);
    // The user fixes the open time while the run waits on Alpaca for the old one.
    await app.patch(id, { openedAt: OPEN + 86_400_000 });
    release();
    expect((await run).body.filled).toBe(0);
    expect(await app.prices(id)).toEqual([null, null]);
  });

  it("refuses a body that isn't a list of trade ids, and ignores ids it doesn't know", async () => {
    const app = setup(fakeBars().bars);
    expect((await app.fill({ tradeIds: ["nope"] })).status).toBe(400);
    expect((await app.fill({ tradeIds: [crypto.randomUUID()] })).body).toEqual({
      filled: 0,
      missing: [],
      unavailable: null,
    });
  });
});
