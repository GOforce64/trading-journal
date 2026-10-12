import { describe, expect, it } from "vitest";
import { listOf, QUEUE, readTradeList } from "./tradeList.js";

describe("the list in history state", () => {
  it("reads the queue and lists of ids", () => {
    expect(readTradeList({ tradeList: { kind: "queue" } })).toEqual(QUEUE);
    expect(readTradeList({ tradeList: { kind: "ids", ids: ["a", "b"], label: "Journal" } })).toEqual({
      kind: "ids",
      ids: ["a", "b"],
      label: "Journal",
    });
  });

  it.each([
    null,
    undefined,
    {},
    { tradeList: "x" },
    { tradeList: { kind: "ids", ids: [1], label: "J" } },
    { tradeList: { kind: "ids", ids: [] } },
  ])("reads %o as no list", (state) => {
    expect(readTradeList(state)).toBeNull();
  });

  it("makes a list from rows", () => {
    expect(listOf([{ id: "a" }, { id: "b" }], "Recent")).toEqual({
      kind: "ids",
      ids: ["a", "b"],
      label: "Recent",
    });
  });
});
