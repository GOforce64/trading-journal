import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createIbkrRepo } from "@tj/db";
import { type FlexClient, FlexError } from "@tj/importers";
import { describe, expect, it } from "vitest";
import { LOCAL, testApp, testDb } from "./testing.js";

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
const LIVE = {
  token: "2234567890123456789012",
  activityQueryId: "2653145",
  todayQueryId: "2653147",
  since: "2026-09-28",
};
/** The same statements, from the live account U7654321. */
const asLive = (xml: string) => xml.replaceAll("DU1234567", "U7654321");
const NOW = Date.UTC(2026, 8, 29, 1, 0);

interface Summary {
  book: string;
  account: { externalId: string; kind: string } | null;
  status: string;
  ran: boolean;
  added: number;
  updated: number;
  unchanged: number;
  orphaned: number;
  skipped: { reason: string; ticker: string }[];
  keptEdits: { tradeId: string; ticker: string; netPnl: number | null }[];
  ignored: { beforeStart: number; stock: number };
  activityFailed: boolean;
  changedTradeIds: string[];
  error: { kind: string; message: string } | null;
}

interface Report {
  ran: boolean;
  changedTradeIds: string[];
  accounts: Summary[];
}

interface Answers {
  today?: string | Error;
  activity?: string | Error;
  liveToday?: string | Error;
  liveActivity?: string | Error;
}

type Config = typeof CONFIG;

/**
 * The app with a fake Flex client that answers each query from the fixtures, and a clock the test moves. Paper is
 * set up with CONFIG unless told otherwise; live only when given (a function stands for an entry that can't be read).
 */
function setup(
  paper: Config | null = CONFIG,
  answers: Answers = {},
  live: Config | null | (() => Config) = null,
) {
  const asked: string[] = [];
  const deadlines: (number | undefined)[] = [];
  let clock = NOW;
  const books = { paper, live };
  const client: FlexClient = {
    async statement(queryId, until) {
      asked.push(queryId);
      deadlines.push(until);
      // A statement takes a moment, as IBKR's does, so two syncs at once really overlap.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const answer =
        queryId === LIVE.todayQueryId
          ? (answers.liveToday ?? asLive(TODAY_XML))
          : queryId === LIVE.activityQueryId
            ? (answers.liveActivity ?? asLive(ACTIVITY_XML))
            : queryId === CONFIG.todayQueryId
              ? (answers.today ?? TODAY_XML)
              : (answers.activity ?? ACTIVITY_XML);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async checkQuery() {},
  };
  const db = testDb();
  const app = testApp({
    db,
    ibkrConfig: (book) => {
      const config = books[book];
      return typeof config === "function" ? config() : config;
    },
    flexClient: (token) => harness.flexClientFor(token),
    now: () => clock,
  });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  const harness = {
    /** Builds the Flex client for a token: a test can swap it to make one account's client throw. */
    flexClientFor: (_token: string): FlexClient => client,
  };
  const report = async (auto = false) => (await (await post("/api/ibkr/sync", { auto })).json()) as Report;
  return {
    get flexClientFor() {
      return harness.flexClientFor;
    },
    set flexClientFor(build: (token: string) => FlexClient) {
      harness.flexClientFor = build;
    },
    app,
    db,
    asked,
    deadlines,
    books,
    advance: (ms: number) => {
      clock += ms;
    },
    report,
    /** The paper account's summary. */
    async sync(auto = false) {
      const answer = await report(auto);
      const summary = answer.accounts.find((each) => each.book === "paper");
      if (!summary) throw new Error("no paper summary");
      return summary;
    },
    async status() {
      return (await (await app.request("/api/ibkr/status", { headers: LOCAL })).json()) as {
        configured: boolean;
        accounts: {
          book: string;
          since: string;
          lastStatus: string | null;
          lastError: string | null;
          lastSummary: Summary | null;
        }[];
      };
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
    // The last run's counts, but nothing changed now: no trade ids for the page to fetch prices for again.
    expect(await app.sync(true)).toMatchObject({ ran: false, added: 2, changedTradeIds: [] });
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
    expect((await app.status()).accounts).toMatchObject([
      { book: "paper", lastStatus: "error", lastError: message },
    ]);
  });

  it("gives both statements one deadline, two and a half minutes from the start", async () => {
    const { sync, asked, deadlines } = setup();
    await sync();
    expect(asked).toEqual([CONFIG.todayQueryId, CONFIG.activityQueryId]);
    expect(deadlines).toEqual([NOW + 150_000, NOW + 150_000]);
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

  it("keeps a synced fly, notes and all, when a scalp joining its episode stops it being recognised", async () => {
    const answers: Answers = {};
    const app = setup({ ...CONFIG, since: "2026-07-01" }, answers);
    await app.sync();
    const fly = (await app.trades()).find((trade) => trade.underlying === "AA");
    await app.app.request(`/api/trades/${fly?.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ notes: "crush paid" }),
    });
    // A 48C scalp while the fly's short body is still open: the episode is no longer a fly (spec §7's known edge).
    const row = (dateTime: string, quantity: number, id: string) =>
      `<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717C00048000" description="AA 17JUL26 48 C" conid="835947199" underlyingSymbol="AA" multiplier="100" strike="48" expiry="20260717" putCall="C" tradeID="${id}" dateTime="${dateTime}" tradeDate="20260716" transactionType="ExchTrade" quantity="${quantity}" tradePrice="0.9" ibCommission="-0.5" openCloseIndicator="${quantity > 0 ? "O" : "C"}" notes="" buySell="${quantity > 0 ? "BUY" : "SELL"}" ibOrderID="9${id}" transactionID="1${id}" ibExecID="0000e183.aaaa${id}.01.01" origTradeID="" levelOfDetail="EXECUTION" />\n`;
    answers.activity = ACTIVITY_XML.replace(
      "</Trades>",
      `${row("20260716;150000", 1, "901")}${row("20260716;151000", -1, "902")}</Trades>`,
    );

    const second = await app.sync();
    expect(second.orphaned).toBe(0);
    expect(second.skipped).toContainEqual(expect.objectContaining({ reason: "unrecognised", ticker: "AA" }));
    const kept = (await (await app.app.request(`/api/trades/${fly?.id}`, { headers: LOCAL })).json()) as {
      notes: string | null;
      fills: unknown[];
    };
    expect(kept.notes).toBe("crush paid");
    // Its fills stay linked, so the next sync keeps it too.
    expect(kept.fills.length).toBeGreaterThan(0);
    expect((await app.sync()).orphaned).toBe(0);
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

  it("answers no accounts without credentials", async () => {
    const app = setup(null);
    expect(await app.report()).toEqual({ ran: false, changedTradeIds: [], accounts: [] });
    expect(app.asked).toEqual([]);
    expect(await app.status()).toEqual({ configured: false, accounts: [] });
  });
});

describe("the live account (live-sync spec §4)", () => {
  const rows = async (app: ReturnType<typeof setup>) =>
    (await app.trades()).map((trade) => [trade.underlying, trade.netPnl, trade.book]).sort();

  it("syncs both accounts, each into its own book", async () => {
    const app = setup(CONFIG, {}, LIVE);
    const report = await app.report();
    expect(report.accounts.map((each) => [each.book, each.account?.kind, each.account?.externalId])).toEqual([
      ["paper", "paper", "DU1234567"],
      ["live", "live", "U7654321"],
    ]);
    expect(report.ran).toBe(true);
    expect(await rows(app)).toEqual([
      ["NVDA", 44.74, "live"],
      ["NVDA", 44.74, "paper"],
      ["TSLA", 300.55, "live"],
      ["TSLA", 300.55, "paper"],
    ]);
    expect(report.changedTradeIds).toHaveLength(4);
    expect((await app.status()).accounts.map((each) => [each.book, each.lastStatus])).toEqual([
      ["paper", "ok"],
      ["live", "ok"],
    ]);
  });

  it("syncs the live account alone", async () => {
    const app = setup(null, {}, LIVE);
    const report = await app.report();
    expect(report.accounts.map((each) => [each.book, each.status, each.added])).toEqual([["live", "ok", 2]]);
    expect(await rows(app)).toEqual([
      ["NVDA", 44.74, "live"],
      ["TSLA", 300.55, "live"],
    ]);
  });

  it("refuses queries from the other kind of account, and stores nothing", async () => {
    const app = setup(null, { liveToday: TODAY_XML, liveActivity: ACTIVITY_XML }, LIVE);
    const [live] = (await app.report()).accounts;
    expect(live).toMatchObject({
      book: "live",
      status: "error",
      error: {
        kind: "failed",
        message: "These queries belong to the paper account DU1234567: use the live account's own queries.",
      },
    });
    expect(await app.trades()).toEqual([]);
  });

  it("refuses live queries saved as paper", async () => {
    const app = setup({ ...CONFIG }, { today: asLive(TODAY_XML), activity: asLive(ACTIVITY_XML) });
    expect((await app.sync()).error?.message).toBe(
      "These queries belong to the live account U7654321: use the paper account's own queries.",
    );
    expect(await app.trades()).toEqual([]);
  });

  it("keeps one account's trades when the other fails", async () => {
    const app = setup(CONFIG, { liveToday: new FlexError("token", "IBKR rejected the token.") }, LIVE);
    const report = await app.report();
    expect(
      report.accounts.map((each) => [each.book, each.status, each.added, each.error?.kind ?? null]),
    ).toEqual([
      ["paper", "ok", 2, null],
      ["live", "error", 0, "token"],
    ]);
    expect(report.changedTradeIds).toHaveLength(2);
    expect(await rows(app)).toEqual([
      ["NVDA", 44.74, "paper"],
      ["TSLA", 300.55, "paper"],
    ]);
  });

  it("reports a live run that crashes outright as live's error, and still syncs paper", async () => {
    const app = setup(CONFIG, {}, LIVE);
    const client = app.flexClientFor;
    app.flexClientFor = (token) => {
      if (token === LIVE.token) throw new Error("boom");
      return client(token);
    };
    const report = await app.report();
    expect(report.accounts.map((each) => [each.book, each.status, each.error?.message ?? null])).toEqual([
      ["paper", "ok", null],
      ["live", "error", "The sync failed unexpectedly."],
    ]);
    expect(report.changedTradeIds).toHaveLength(2);
  });

  it("keeps paper syncing when the live entry can't be read", async () => {
    const app = setup(CONFIG, {}, () => {
      throw new Error("secrets.json: check ibkrLive.token");
    });
    const report = await app.report();
    expect(report.accounts.map((each) => [each.book, each.status])).toEqual([["paper", "ok"]]);
    expect((await app.status()).accounts.map((each) => each.book)).toEqual(["paper"]);
  });

  it("runs the 15-minute rule per account", async () => {
    const app = setup();
    await app.report();
    expect(app.asked).toEqual([CONFIG.todayQueryId, CONFIG.activityQueryId]);
    app.books.live = LIVE;
    app.advance(60_000);
    const report = await app.report(true);
    expect(app.asked.slice(2)).toEqual([LIVE.todayQueryId, LIVE.activityQueryId]);
    expect(report.accounts.map((each) => [each.book, each.ran])).toEqual([
      ["paper", false],
      ["live", true],
    ]);
    expect(report.ran).toBe(true);
    expect(report.changedTradeIds).toHaveLength(2);
  });

  it("runs one sync at a time, for both accounts", async () => {
    const app = setup(CONFIG, {}, LIVE);
    const [first, second] = await Promise.all([app.report(), app.report()]);
    expect(first).toEqual(second);
    expect(app.asked).toHaveLength(4);
  });

  it("reads the paper run recorded before live existed", async () => {
    const app = setup();
    const { book: _book, ...before } = await app.sync();
    // A row as the paper-only sync wrote it: its summary has no book.
    createIbkrRepo(app.db, () => NOW).recordRun("ibkr", {
      at: NOW,
      status: "ok",
      error: null,
      summary: before,
      accountId: null,
    });
    const [paper] = (await app.status()).accounts;
    expect(paper).toMatchObject({
      book: "paper",
      lastStatus: "ok",
      lastSummary: { book: "paper", added: 2 },
    });
  });

  it("hands a live trade back to IBKR's numbers", async () => {
    const app = setup(CONFIG, {}, LIVE);
    await app.report();
    const nvda = (await app.trades()).find((trade) => trade.underlying === "NVDA" && trade.book === "live");
    await app.app.request(`/api/trades/${nvda?.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ netPnl: 50 }),
    });
    const reset = (await (await app.post(`/api/ibkr/trades/${nvda?.id}/reset`, {})).json()) as Report;
    expect(reset.accounts.map((each) => each.book)).toEqual(["paper", "live"]);
    expect((await app.trades()).find((trade) => trade.id === nvda?.id)?.netPnl).toBe(44.74);
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
