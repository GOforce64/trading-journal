import { nyWallClock } from "@tj/core";
import { describe, expect, it } from "vitest";
import { LOCAL, testApp } from "./testing.js";

const JSON_HEADERS = { "content-type": "application/json", ...LOCAL };
const ENTRY = nyWallClock("2026-09-30", 9 * 60 + 41);
const EXIT = nyWallClock("2026-09-30", 9 * 60 + 58);

/** A missed NVDA long marked at 09:41 on Sep 30, with only its entry. */
const missed = (overrides: Record<string, unknown> = {}) => ({
  strategy: "scalp",
  book: "missed",
  underlying: "NVDA",
  openedAt: ENTRY,
  missed: { direction: "long", entryPrice: 178.42, stopPrice: null, targetPrice: null, exitPrice: null },
  ...overrides,
});

interface MissedView {
  id: string;
  book: string;
  missed: {
    direction: string;
    entryPrice: number;
    stopPrice: number | null;
    exitPrice: number | null;
  } | null;
  missedRisk: { r: number | null; problem: string | null } | null;
}

function setup() {
  const app = testApp();
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    send,
    async create(body: unknown = missed()) {
      const res = await send("POST", "/api/trades", body);
      return { status: res.status, body: (await res.json()) as MissedView & { message?: string } };
    },
    async patch(id: string, body: unknown) {
      const res = await send("PATCH", `/api/trades/${id}`, body);
      return { status: res.status, body: (await res.json()) as MissedView & { message?: string } };
    },
    async list(query: string) {
      return (await (await app.request(`/api/trades${query}`, { headers: LOCAL })).json()) as MissedView[];
    },
  };
}

describe("missed trades through the trade routes", () => {
  it("creates one with only its entry, its R waiting on a stop", async () => {
    const app = setup();
    const { status, body } = await app.create();
    expect(status).toBe(201);
    expect(body.missed).toMatchObject({ direction: "long", entryPrice: 178.42 });
    expect(body.missedRisk).toMatchObject({ r: null, problem: "no_stop" });
  });

  it("refuses what a missed trade can't have", async () => {
    const app = setup();
    const leg = { right: "C", strike: 180, expiry: "2026-09-30", quantity: 1, openPrice: 1 };
    for (const body of [
      missed({ legs: [leg] }),
      missed({ netPnl: 10 }),
      missed({ book: "live" }),
      missed({ missed: undefined }),
      missed({
        missed: { direction: "long", entryPrice: 0, stopPrice: null, targetPrice: null, exitPrice: null },
      }),
      missed({ closedAt: EXIT }),
    ]) {
      expect((await app.create(body)).status).toBe(400);
    }
  });

  it("refuses an exit before the entry or on another day, with the reason", async () => {
    const app = setup();
    const { body } = await app.create();
    const early = await app.patch(body.id, { missed: { exitPrice: 179 }, closedAt: ENTRY - 60_000 });
    expect(early).toMatchObject({ status: 400, body: { message: "The exit must come after the entry" } });
    const late = await app.patch(body.id, {
      missed: { exitPrice: 179 },
      closedAt: nyWallClock("2026-10-01", 9 * 60 + 35),
    });
    expect(late).toMatchObject({
      status: 400,
      body: { message: "The exit must be on the entry's day, Sep 30" },
    });
  });

  it("scores it once the stop and exit are in", async () => {
    const app = setup();
    const { body } = await app.create();
    await app.patch(body.id, { missed: { stopPrice: 177.8 } });
    const { body: closed } = await app.patch(body.id, { missed: { exitPrice: 179.9 }, closedAt: EXIT });
    expect(closed.missedRisk?.problem).toBeNull();
    expect(closed.missedRisk?.r).toBeCloseTo(1.48 / 0.62, 9);
  });

  it("refuses a second skip reason", async () => {
    const app = setup();
    const { body } = await app.create();
    const make = async (name: string) =>
      ((await (await app.send("POST", "/api/tags", { name, kind: "skip" })).json()) as { id: string }).id;
    const first = await make("Hesitated, again");
    const second = await make("Saw it later");
    expect(await app.patch(body.id, { tagIds: [first, second] })).toMatchObject({
      status: 400,
      body: { message: "A trade has at most one skip reason" },
    });
  });

  it("lists taken trades without the missed ones", async () => {
    const app = setup();
    const { body: kept } = await app.create();
    await app.create(missed({ book: "paper", missed: null, closedAt: EXIT, netPnl: 5 }));
    const taken = await app.list("?taken=true");
    expect(taken.map((trade) => trade.book)).toEqual(["paper"]);
    expect((await app.list("?book=missed")).map((trade) => trade.id)).toEqual([kept.id]);
    expect(taken[0]?.missedRisk).toBeNull();
  });
});
