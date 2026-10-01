import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FlexParseError, flexTime, parseFlex } from "./parse.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const activity = parseFlex(fixture("activity.xml"));
const today = parseFlex(fixture("today.xml"));

describe("flexTime", () => {
  it("reads IBKR's New York time, seconds included", () => {
    expect(flexTime("20260716;135242")).toBe(Date.UTC(2026, 6, 16, 17, 52, 42));
    expect(flexTime("20261201;093000")).toBe(Date.UTC(2026, 11, 1, 14, 30, 0));
  });

  it("puts a booking with a date alone at 16:20 New York", () => {
    expect(flexTime("20260725")).toBe(Date.UTC(2026, 6, 25, 20, 20));
  });
});

describe("parseFlex on an Activity statement", () => {
  it("names the account, the kind and the period", () => {
    expect(activity).toMatchObject({
      accountId: "DU1234567",
      kind: "activity",
      fromDate: "2025-09-26",
      toDate: "2026-09-25",
    });
  });

  it("turns an exchange execution into a fill, ids kept as strings and commission as positive dollars", () => {
    const fill = activity.fills.find((each) => each.key === "0000e183.6a58737f.04.01");
    expect(fill).toEqual({
      key: "0000e183.6a58737f.04.01",
      tradeId: "1785797699",
      orderId: "725886161",
      conid: "835947148",
      underlying: "AA",
      right: "C",
      strike: 47,
      expiry: "2026-07-17",
      multiplier: 100,
      tradeDate: "2026-07-16",
      executedAt: Date.UTC(2026, 6, 16, 17, 52, 42),
      quantity: -1,
      price: 1.37,
      commission: 0.7934122,
      openClose: "O",
      kind: "trade",
      raw: expect.objectContaining({ ibExecID: "0000e183.6a58737f.04.01" }),
    });
  });

  it("turns an expiry booking into an expiration at $0, keyed by its trade id", () => {
    const expiry = activity.fills.find((each) => each.key === "trade-1787168394");
    expect(expiry).toMatchObject({
      underlying: "AA",
      right: "C",
      strike: 54,
      quantity: -2,
      price: 0,
      commission: 0,
      kind: "expiration",
      openClose: "C",
      executedAt: Date.UTC(2026, 6, 17, 20, 20),
    });
  });

  it("prices an exercise at the mark IBKR gives it, not the $0 it books", () => {
    const exercise = activity.fills.find((each) => each.key === "trade-1792882249");
    expect(exercise).toMatchObject({
      underlying: "CLF",
      right: "C",
      strike: 11.5,
      kind: "exercise",
      price: 0.42,
    });
  });

  it("returns a cancel by trade id, size and price, and keeps the correction booked under the same id", () => {
    expect(activity.cancels).toEqual([
      { tradeId: "1786699376", quantity: 2, price: 0.73, tradeDate: "2026-07-17" },
    ]);
    const booked = activity.fills.filter((each) => each.tradeId === "1786699376").map((each) => each.key);
    expect(booked).toEqual(["0001938c.6a59af42.01.01", "0001938c.6a59af42.01.02"]);
  });

  it("counts stock rows as ignored", () => {
    expect(activity.ignored).toEqual({ stock: 2, other: 0, malformed: 0 });
  });

  it("reads all 21 option fills", () => {
    // 24 rows: 2 stock, 1 cancel, 21 option fills.
    expect(activity.fills).toHaveLength(21);
  });
});

describe("parseFlex on a Trade Confirmation statement", () => {
  it("maps Today's field names onto the same fill shape", () => {
    expect(today).toMatchObject({ accountId: "DU1234567", kind: "confirm", fromDate: "2026-09-28" });
    expect(today.fills).toHaveLength(7);
    expect(today.fills[0]).toMatchObject({
      key: "0000e242.6ab9e843.01.01",
      orderId: "754464364",
      conid: "924107824",
      underlying: "NVDA",
      right: "C",
      strike: 232.5,
      expiry: "2026-09-28",
      quantity: 1,
      price: 1.06,
      commission: 0.8453,
      openClose: "O",
      kind: "trade",
      executedAt: Date.UTC(2026, 8, 28, 13, 31, 5),
    });
    expect(today.fills.find((each) => each.key === "0000e242.6ab9e92d.01.01")?.openClose).toBe("C");
  });

  it("keeps IBKR's mark for a fill that closes one position and opens another", () => {
    const xml = fixture("activity.xml").replace('openCloseIndicator="C"', 'openCloseIndicator="C;O"');
    const marks = parseFlex(xml).fills.map((fill) => fill.openClose);
    expect(marks.filter((mark) => mark === "C;O")).toHaveLength(1);
    // Today's codes list the marks among others, in any order.
    const today = fixture("today.xml").replace(' code="O;P"', ' code="O;P;C"');
    expect(parseFlex(today).fills.filter((fill) => fill.openClose === "C;O")).toHaveLength(1);
  });

  it("reads a same-day cancel by Today's price field, not as malformed", () => {
    // Today's rows name the price "price" where Activity's say "tradePrice".
    const xml = fixture("today.xml");
    const first = /<TradeConfirm [^>]*\/>/.exec(xml)?.[0] ?? "";
    const cancel = first
      .replace('transactionType="ExchTrade"', 'transactionType="TradeCancel" origTradeID="1866047710"')
      .replace('quantity="1"', 'quantity="-1"')
      .replace(/execID="[^"]*"/, 'execID="cancel-1"');
    const parsed = parseFlex(xml.replace(first, `${first}${cancel}`));
    expect(parsed.cancels).toEqual([
      { tradeId: "1866047710", quantity: 1, price: 1.06, tradeDate: "2026-09-28" },
    ]);
    expect(parsed.ignored.malformed).toBe(0);
  });

  it("reads an empty statement, a day with no trades, as no fills", () => {
    const empty = fixture("today.xml").replace(
      /<TradeConfirms>[\s\S]*<\/TradeConfirms>/,
      "<TradeConfirms />",
    );
    expect(parseFlex(empty)).toMatchObject({
      fills: [],
      cancels: [],
      ignored: { stock: 0, other: 0, malformed: 0 },
    });
  });
});

describe("parseFlex with bad input", () => {
  it("skips a malformed row and counts it, without failing the rest", () => {
    const broken = fixture("today.xml").replace('strike="232.5"', 'strike=""');
    const parsed = parseFlex(broken);
    expect(parsed.ignored.malformed).toBe(1);
    expect(parsed.fills).toHaveLength(6);
  });

  it("refuses something that isn't a Flex statement", () => {
    expect(() => parseFlex("<html></html>")).toThrow(FlexParseError);
  });

  it("refuses a query that covers more than one account", () => {
    const two = fixture("today.xml").replace(/(<FlexStatement [\s\S]*<\/FlexStatement>)/, "$1$1");
    expect(() => parseFlex(two)).toThrow("more than one account");
  });
});
