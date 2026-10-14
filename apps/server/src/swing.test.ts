import { describe, expect, it } from "vitest";
import { LOCAL, testApp } from "./testing.js";

const JSON_HEADERS = { "content-type": "application/json", host: "localhost" };

/** A long call held over a weekend: 2 Oct 2026 to 5 Oct 2026. */
const longCall = {
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  structureLabel: "Long call",
  openedAt: Date.UTC(2026, 9, 2, 14, 15),
  closedAt: Date.UTC(2026, 9, 5, 15, 0),
  netPnl: 100,
  fees: 2,
  legs: [{ right: "C", strike: 230, expiry: "2026-11-06", quantity: 1, openPrice: 5, closePrice: 6.02 }],
};
const vertical = {
  ...longCall,
  strategy: "swing",
  structureLabel: "Call debit spread",
  legs: [
    { right: "C", strike: 230, expiry: "2026-11-06", quantity: 1, openPrice: 5.1, closePrice: 9 },
    { right: "C", strike: 240, expiry: "2026-11-06", quantity: -1, openPrice: 1.3, closePrice: 1.15 },
  ],
};

function setup() {
  const app = testApp();
  const send = (method: string, path: string, body: unknown) =>
    app.request(path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
  const post = async (body: unknown) =>
    (await (await send("POST", "/api/trades", body)).json()) as { id: string };
  const list = async (query: string) =>
    (await (await app.request(`/api/trades?${query}`, { headers: LOCAL })).json()) as { id: string }[];
  return { app, send, post, list };
}

describe("swings through the API (swing spec §3.5, §6.2)", () => {
  it("switches a scalp to a swing, lists it with the swings, and takes it out of the review queue", async () => {
    const { send, post, list } = setup();
    const { id } = await post(longCall);
    expect((await list("strategy=scalp&review=pending")).map((trade) => trade.id)).toEqual([id]);
    const res = await send("PATCH", `/api/trades/${id}`, { chosenStrategy: "swing" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ strategy: "swing", chosenStrategy: "swing" });
    expect((await list("strategy=swing")).map((trade) => trade.id)).toEqual([id]);
    expect(await list("strategy=swing&review=pending")).toEqual([]);
    expect(await list("strategy=scalp&review=pending")).toEqual([]);
  });

  it("refuses the switch on a vertical, saying why", async () => {
    const { send, post } = setup();
    const { id } = await post(vertical);
    const res = await send("PATCH", `/api/trades/${id}`, { chosenStrategy: "scalp" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: "Only a single bought call or put can be switched." });
  });

  it("takes a setup for swings", async () => {
    const { send } = setup();
    const res = await send("POST", "/api/setups", { name: "Weekly breakout", strategy: "swing" });
    expect(res.ok).toBe(true);
    expect(await res.json()).toMatchObject({ strategy: "swing" });
  });
});
