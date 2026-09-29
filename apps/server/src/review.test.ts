import { describe, expect, it } from "vitest";
import { LOCAL, testApp } from "./testing.js";

const JSON_HEADERS = { "content-type": "application/json", host: "localhost" };
const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

/** The Sep 28 NVDA 232.5C scalp, opened `minute` minutes after 09:30 ET and held 15 minutes. */
const scalp = (minute: number) => ({
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  structureLabel: "Long call",
  openedAt: Date.UTC(2026, 8, 28, 13, 30 + minute),
  closedAt: Date.UTC(2026, 8, 28, 13, 45 + minute),
  netPnl: 44.74,
  fees: 2.26,
  legs: [
    { right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2, openPrice: 1.06, closePrice: 1.295 },
  ],
});

/** A balanced fly, closed. */
const fly = {
  strategy: "iron_fly",
  book: "paper",
  underlying: "AA",
  openedAt: Date.UTC(2026, 6, 16, 19, 50),
  closedAt: Date.UTC(2026, 6, 17, 13, 45),
  netPnl: 27.5,
  fees: 5,
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

interface Reviewed {
  id: string;
  review: { status: string; missing: string[] } | null;
  scalp: { levelBasis: string; stopPrice: number | null; targetPrice: number | null } | null;
  reviewedAt: number | null;
}

function setup(now?: () => number) {
  const app = testApp({ now });
  const post = async (body: unknown) =>
    readJson<Reviewed>(
      await app.request("/api/trades", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }),
    );
  const patch = (id: string, body: unknown) =>
    app.request(`/api/trades/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
  const pending = async () =>
    (
      await readJson<Reviewed[]>(
        await app.request("/api/trades?strategy=scalp&review=pending", { headers: LOCAL }),
      )
    ).map((trade) => trade.id);
  /** The id of a seeded setup or tag, by name. */
  const idOf = async (path: "/api/setups" | "/api/tags", name: string) => {
    const items = await readJson<{ id: string; name: string }[]>(await app.request(path, { headers: LOCAL }));
    const found = items.find((item) => item.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found.id;
  };
  return { app, post, patch, pending, idOf };
}

describe("the scalp review API", () => {
  it("says what a new scalp lacks, and nothing about a fly", async () => {
    const { post } = setup();
    const nvda = await post(scalp(1));
    expect(nvda.review).toEqual({ status: "pending", missing: ["setup", "grade", "stop"] });
    expect(nvda.scalp).toBeNull();
    expect((await post(fly)).review).toBeNull();
  });

  it("takes the levels, the grade and the setup, and lets the scalp out of the queue", async () => {
    const { post, patch, idOf } = setup();
    const nvda = await post(scalp(1));
    const res = await patch(nvda.id, {
      scalp: { levelBasis: "stock", stopPrice: 231.8 },
      grade: "B",
      setupId: await idOf("/api/setups", "ORB breakout"),
    });
    expect(res.status).toBe(200);
    const body = await readJson<Reviewed>(res);
    expect(body.review).toEqual({ status: "done", missing: [] });
    expect(body.scalp).toMatchObject({ levelBasis: "stock", stopPrice: 231.8, targetPrice: null });
  });

  it("lists the queue oldest first: every pending scalp, and nothing else", async () => {
    const { post, patch, pending } = setup();
    const late = await post(scalp(20));
    const early = await post(scalp(0));
    const done = await post(scalp(10));
    await post(fly);
    await post({ ...scalp(30), closedAt: null, netPnl: null });
    await patch(done.id, { reviewed: true });
    expect(await pending()).toEqual([early.id, late.id]);
  });

  it("stamps Done reviewing with the server's clock", async () => {
    const { post, patch } = setup(() => 7_000);
    const nvda = await post(scalp(1));
    expect((await readJson<Reviewed>(await patch(nvda.id, { reviewed: true }))).reviewedAt).toBe(7_000);
  });

  it("refuses what the review rules refuse, saying why", async () => {
    const { post, patch, idOf } = setup();
    const nvda = await post(scalp(1));
    const aa = await post(fly);
    const refusal = async (id: string, body: unknown) => {
      const res = await patch(id, body);
      return { status: res.status, message: (await readJson<{ message?: string }>(res)).message };
    };
    expect(await refusal(aa.id, { scalp: { levelBasis: "stock", stopPrice: 46 } })).toEqual({
      status: 400,
      message: "Only a scalp has a stop and target",
    });
    expect(await refusal(nvda.id, { scalp: { stopPrice: 231.8 } })).toEqual({
      status: 400,
      message: "A scalp's first level needs a basis",
    });
    expect(await refusal(nvda.id, { scalp: { levelBasis: "stock", stopPrice: 0 } })).toEqual({
      status: 400,
      message: "A stock price must be above 0",
    });
    const tagIds = [await idOf("/api/tags", "Calm"), await idOf("/api/tags", "Rushed")];
    expect(await refusal(nvda.id, { tagIds })).toEqual({
      status: 400,
      message: "A trade has at most one emotion",
    });
    expect((await patch(nvda.id, { scalp: { levelBasis: "stock", stopPrice: -1 } })).status).toBe(400);
  });
});
