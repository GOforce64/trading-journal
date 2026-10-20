import { describe, expect, it } from "vitest";
import { readTradeList, type TradeList } from "./nav/tradeList.js";
import { editTrade, router, savedTrade } from "./router.js";

const LIST: TradeList = { kind: "ids", ids: ["t0", "t1", "t2"], label: "Scalps" };
const here = () => ({
  path: router.state.location.pathname,
  list: readTradeList(router.state.location.state),
});

describe("a trade's list through Edit (launcher spec §14)", () => {
  it("goes to the edit page and back to the trade with the list J and K follow", async () => {
    await router.navigate({ to: "/trades/$id", params: { id: "t1" }, state: { tradeList: LIST } });
    await editTrade("t1");
    expect(here()).toEqual({ path: "/trades/t1/edit", list: LIST });
    await savedTrade("t1");
    expect(here()).toEqual({ path: "/trades/t1", list: LIST });
  });

  it("opens a trade with no list as it was, when the edit page had none", async () => {
    await router.navigate({ to: "/trades/$id/edit", params: { id: "t2" }, search: {} });
    await savedTrade("t2");
    expect(here()).toEqual({ path: "/trades/t2", list: null });
  });
});
