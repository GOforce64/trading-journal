import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type FlexClient, FlexError } from "@tj/importers";
import { describe, expect, it } from "vitest";
import { LOCAL, testApp } from "./testing.js";

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../packages/importers/src/ibkr/fixtures/${name}`, import.meta.url)),
    "utf8",
  );
const TODAY_XML = fixture("today.xml");
const ACTIVITY_XML = fixture("activity.xml");
const JSON_HEADERS = { "content-type": "application/json", ...LOCAL };
const CONFIG = {
  token: "1234567890123456789012",
  activityQueryId: "1653145",
  todayQueryId: "1653147",
  since: "2026-09-28",
};
const NOW = Date.UTC(2026, 8, 29, 1, 0);

interface Summary {
  status: string;
  ran: boolean;
  added: number;
  updated: number;
  unchanged: number;
  skipped: { reason: string; ticker: string }[];
  keptEdits: { tradeId: string; ticker: string; netPnl: number | null }[];
  ignored: { beforeStart: number; stock: number };
  activityFailed: boolean;
  changedTradeIds: string[];
  error: { kind: string; message: string } | null;
}

interface Answers {
  today?: string | Error;
  activity?: string | Error;
}

/** The app with a fake Flex client that answers each query from the fixtures, and a clock the test moves. */
function setup(config: typeof CONFIG | null = CONFIG, answers: Answers = {}) {
  const asked: string[] = [];
  let clock = NOW;
  const client: FlexClient = {
    async statement(queryId) {
      asked.push(queryId);
      // A statement takes a moment, as IBKR's does, so two syncs at once really overlap.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const answer =
        queryId === CONFIG.todayQueryId ? (answers.today ?? TODAY_XML) : (answers.activity ?? ACTIVITY_XML);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async checkQuery() {},
  };
  const app = testApp({ ibkrConfig: () => config, flexClient: () => client, now: () => clock });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  return {
    app,
    asked,
    advance: (ms: number) => {
      clock += ms;
    },
    async sync(auto = false) {
      return (await (await post("/api/ibkr/sync", { auto })).json()) as Summary;
    },
    async trades() {
      return (await (await app.request("/api/trades", { headers: LOCAL })).json()) as {
        id: string;
        underlying: string;
        netPnl: number | null;
        source: string;
        book: string;
        factsEditedAt: number | null;
      }[];
    },
    post,
  };
}

describe("POST /api/ibkr/sync", () => {
  it("brings in this morning's scalps, and nothing from before the start date", async () => {
    const app = setup();
    const summary = await app.sync();
    expect(summary).toMatchObject({ status: "ok", ran: true, added: 2, activityFailed: false, error: null });
    expect(summary.ignored).toMatchObject({ beforeStart: 21, stock: 2 });
    const trades = await app.trades();
    expect(trades.map((trade) => [trade.underlying, trade.netPnl, trade.source, trade.book]).sort()).toEqual([
      ["NVDA", 44.74, "ibkr_flex", "paper"],
      ["TSLA", 300.55, "ibkr_flex", "paper"],
    ]);
  });

  it("brings in the Activity statement's trades from an earlier start date, skipping what it can't place", async () => {
    const app = setup({ ...CONFIG, since: "2026-07-01" });
    const summary = await app.sync();
    // NVDA, TSLA, the AA fly and CZR's call and put.
    expect(summary.added).toBe(5);
    expect(summary.skipped).toContainEqual(
      expect.objectContaining({ reason: "before_start", ticker: "CLF" }),
    );
  });

  it("changes nothing on a second sync", async () => {
    const app = setup();
    await app.sync();
    expect(await app.sync()).toMatchObject({ added: 0, updated: 0, unchanged: 2 });
  });

  it("doesn't run an automatic sync within 15 minutes of the last one", async () => {
    const app = setup();
    await app.sync();
    app.advance(10 * 60_000);
    expect(await app.sync(true)).toMatchObject({ ran: false, added: 2 });
    expect(app.asked).toHaveLength(2);
    app.advance(6 * 60_000);
    expect((await app.sync(true)).ran).toBe(true);
    expect(app.asked).toHaveLength(4);
  });

  it("runs one sync at a time", async () => {
    const app = setup();
    const [first, second] = await Promise.all([app.sync(), app.sync()]);
    expect(first).toEqual(second);
    expect(app.asked).toHaveLength(2);
  });

  it("stops on a rejected token and records the error", async () => {
    const message =
      "IBKR rejected the token (Token has expired.). It may have expired: tokens last up to a year. Generate a new one in Client Portal and save it in Settings.";
    const app = setup(CONFIG, { today: new FlexError("token", message) });
    const summary = await app.sync();
    expect(summary).toMatchObject({ status: "error", error: { kind: "token", message }, added: 0 });
    const status = (await (await app.app.request("/api/ibkr/status", { headers: LOCAL })).json()) as {
      lastStatus: string;
      lastError: string;
    };
    expect(status).toMatchObject({ lastStatus: "error", lastError: message });
  });

  it("keeps today's fills when the Activity statement fails", async () => {
    const app = setup(CONFIG, {
      activity: new FlexError("slow", "IBKR is still preparing the statement. Try again shortly."),
    });
    expect(await app.sync()).toMatchObject({ status: "ok", added: 2, activityFailed: true });
  });

  it("ignores a cancel from before the start date, so a correction booked under its trade id stands", async () => {
    // CZR's 2-lot is canceled and re-booked under the same trade id. Here the original and its cancel fall before the
    // start date, and the correction (made the same size) after it.
    const once = (xml: string, from: string, to: string) => {
      if (xml.split(from).length !== 2) throw new Error(`expected one ${from}`);
      return xml.replace(from, to);
    };
    let activity = once(
      ACTIVITY_XML,
      'tradeDate="20260717" transactionType="ExchTrade" quantity="2" tradePrice="0.73"',
      'tradeDate="20260716" transactionType="ExchTrade" quantity="2" tradePrice="0.73"',
    );
    activity = once(
      activity,
      'tradeDate="20260717" transactionType="TradeCancel"',
      'tradeDate="20260716" transactionType="TradeCancel"',
    );
    activity = once(
      activity,
      'tradeDate="20260717" transactionType="ExchTrade" quantity="1" tradePrice="0.73" ibCommission="0.3333"',
      'tradeDate="20260717" transactionType="ExchTrade" quantity="2" tradePrice="0.73" ibCommission="0.3333"',
    );
    const app = setup({ ...CONFIG, since: "2026-07-17" }, { activity });
    await app.sync();
    const trades = (await (await app.app.request("/api/trades", { headers: LOCAL })).json()) as {
      underlying: string;
      legs: { right: string; quantity: number }[];
    }[];
    const call = trades.find((trade) => trade.underlying === "CZR" && trade.legs[0]?.right === "C");
    // The correction's 2 and the later 1-lot.
    expect(call?.legs[0]?.quantity).toBe(3);
  });

  it("records a clean run on a day with no trades", async () => {
    const empty = TODAY_XML.replace(/<TradeConfirms>[\s\S]*<\/TradeConfirms>/, "<TradeConfirms />");
    const app = setup(CONFIG, { today: empty });
    expect(await app.sync()).toMatchObject({ status: "ok", added: 0, error: null });
  });

  it("skips a fly already imported from oQuants", async () => {
    const app = setup({ ...CONFIG, since: "2026-07-01" });
    await app.post("/api/trades", {
      strategy: "iron_fly",
      book: "paper",
      underlying: "AA",
      source: "oquants_extract",
      openedAt: Date.UTC(2026, 6, 16, 17, 54),
      closedAt: Date.UTC(2026, 6, 17, 13, 54),
      netPnl: 33.56,
      fees: 6.44,
      legs: [
        { right: "C", strike: 47, expiry: "2026-07-17", quantity: -2, openPrice: 1.37, closePrice: 0.33 },
      ],
      ironFly: {
        bodyPutStrike: 47,
        bodyCallStrike: 47,
        putWingStrike: 40,
        callWingStrike: 54,
        contracts: 2,
        creditPerShare: 2.65,
      },
    });
    const summary = await app.sync();
    expect(summary.skipped).toContainEqual(expect.objectContaining({ reason: "duplicate", ticker: "AA" }));
    expect((await app.trades()).filter((trade) => trade.underlying === "AA")).toHaveLength(1);
  });

  it("never brings back a deleted trade", async () => {
    const app = setup();
    await app.sync();
    const nvda = (await app.trades()).find((trade) => trade.underlying === "NVDA");
    await app.app.request(`/api/trades/${nvda?.id}`, { method: "DELETE", headers: LOCAL });
    const summary = await app.sync();
    expect(summary.skipped).toContainEqual(expect.objectContaining({ reason: "deleted", ticker: "NVDA" }));
  });

  it("answers not_configured without credentials", async () => {
    const app = setup(null);
    expect(await app.sync()).toMatchObject({ status: "not_configured", ran: false });
    expect(app.asked).toEqual([]);
  });
});

describe("the user's edits", () => {
  it("are kept by later syncs until the user asks for IBKR's numbers", async () => {
    const app = setup();
    await app.sync();
    const nvda = (await app.trades()).find((trade) => trade.underlying === "NVDA");
    await app.app.request(`/api/trades/${nvda?.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ netPnl: 50 }),
    });
    const kept = await app.sync();
    // IBKR's own number, which the trade page shows beside the user's.
    expect(kept.keptEdits).toEqual([{ tradeId: nvda?.id, ticker: "NVDA", netPnl: 44.74 }]);
    expect((await app.trades()).find((trade) => trade.id === nvda?.id)?.netPnl).toBe(50);

    const reset = await app.post(`/api/ibkr/trades/${nvda?.id}/reset`, {});
    expect(reset.status).toBe(200);
    expect((await app.trades()).find((trade) => trade.id === nvda?.id)).toMatchObject({
      netPnl: 44.74,
      factsEditedAt: null,
    });
  });

  it("answers 404 for a reset of a trade the sync doesn't own", async () => {
    const app = setup();
    const res = await app.post("/api/ibkr/trades/nope/reset", {});
    expect(res.status).toBe(404);
    // The route's own answer, not the framework's for a path it doesn't know.
    expect(await res.json()).toEqual({ error: "not found" });
  });
});

describe("GET /api/trades/:id", () => {
  it("lists a synced trade's fills", async () => {
    const app = setup();
    await app.sync();
    const nvda = (await app.trades()).find((trade) => trade.underlying === "NVDA");
    const detail = (await (await app.app.request(`/api/trades/${nvda?.id}`, { headers: LOCAL })).json()) as {
      fills: { quantity: number; price: number; kind: string }[];
    };
    expect(detail.fills.map((fill) => [fill.quantity, fill.price, fill.kind])).toEqual([
      [1, 1.06, "trade"],
      [1, 1.06, "trade"],
      [-1, 1.44, "trade"],
      [-1, 1.15, "trade"],
    ]);
  });
});
