import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import {
  needsPrices,
  useAutoFillPrices,
  useBackfillPrices,
  useFillScalpPrices,
  usePriceNote,
} from "./prices.js";

const FULL = { entryPrice: 230.83, holdHigh: 233.21, holdLow: 230.71 };
const scalp = (id: string, scalpPrices: unknown = null, closedAt: number | null = 2) =>
  ({ id, strategy: "scalp", closedAt, scalpPrices }) as unknown as TradeView;

function Page({ trade }: { trade: TradeView }) {
  useAutoFillPrices(trade);
  return <p data-testid="note">{usePriceNote(trade.id)}</p>;
}

/** Answers each fill with what `answer` makes of its trade ids. */
function stubFill(answer: (tradeIds: string[]) => unknown) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const { tradeIds } = JSON.parse(String(init?.body)) as { tradeIds: string[] };
    return new Response(JSON.stringify(answer(tradeIds)), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bodies = (fetchMock: ReturnType<typeof stubFill>) =>
  fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));

/** Renders under StrictMode, as the app does, so effects run twice. */
function renderPage(trade: TradeView) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const ui = (next: TradeView) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <Page trade={next} />
      </QueryClientProvider>
    </StrictMode>
  );
  const view = render(ui(trade));
  return { rerender: (next: TradeView) => view.rerender(ui(next)) };
}

const filledAll = () => ({ filled: 1, missing: [], optionMissing: [], unavailable: null });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useFillScalpPrices", () => {
  it("sends a long list, such as a first sync's changed trades, in requests of at most 1,000 ids", async () => {
    const fetchMock = stubFill((tradeIds) => ({
      filled: tradeIds.length,
      missing: [],
      optionMissing: [],
      unavailable: null,
    }));
    const hook: { fill?: ReturnType<typeof useFillScalpPrices> } = {};
    function Probe() {
      hook.fill = useFillScalpPrices();
      return null;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe />
      </QueryClientProvider>,
    );
    const ids = Array.from({ length: 1001 }, (_, index) => `t${index}`);
    const result = await hook.fill?.mutateAsync(ids);
    expect(bodies(fetchMock).map((body) => body.tradeIds.length)).toEqual([1000, 1]);
    expect(result).toEqual({ filled: 1001, missing: [], optionMissing: [], unavailable: null });
  });
});

describe("needsPrices", () => {
  it("says which scalps still lack a price: the stock at entry, or once closed, the hold's range", () => {
    expect(needsPrices(scalp("a"))).toBe(true);
    expect(needsPrices(scalp("a", { ...FULL, holdHigh: null, holdLow: null }))).toBe(true);
    expect(needsPrices(scalp("a", { ...FULL, holdHigh: null, holdLow: null }, null))).toBe(false);
    expect(needsPrices(scalp("a", FULL))).toBe(false);
    expect(needsPrices({ ...scalp("a"), strategy: "iron_fly" } as TradeView)).toBe(false);
  });
});

describe("useAutoFillPrices", () => {
  it("asks once when a scalp's page opens without its prices, even under StrictMode", async () => {
    const fetchMock = stubFill(filledAll);
    renderPage(scalp("t1"));
    expect(screen.getByTestId("note").textContent).toBe("Fetching the stock price…");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodies(fetchMock)).toEqual([{ tradeIds: ["t1"] }]);
  });

  it("asks nothing for a scalp that has its prices", async () => {
    const fetchMock = stubFill(filledAll);
    renderPage(scalp("t1", FULL));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks again for the next scalp, and after an edit clears the prices", async () => {
    const fetchMock = stubFill(filledAll);
    const page = renderPage(scalp("t1"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    page.rerender(scalp("t2"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    page.rerender(scalp("t2", FULL));
    page.rerender(scalp("t2"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(bodies(fetchMock)).toEqual([{ tradeIds: ["t1"] }, { tradeIds: ["t2"] }, { tradeIds: ["t2"] }]);
  });

  it("says Alpaca's delay holds the price back, and asks again a minute later", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubFill((tradeIds) => ({
      filled: 0,
      missing: tradeIds.map((tradeId) => ({ tradeId, reason: "too_recent" })),
      optionMissing: [],
      unavailable: null,
    }));
    renderPage(scalp("t1"));
    await waitFor(() =>
      expect(screen.getByTestId("note").textContent).toBe(
        "Alpaca shares prices 15 minutes late: trying again in a minute.",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("says a failed fetch failed instead of fetching for ever, and asks again a minute later", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage(scalp("t1"));
    await waitFor(() =>
      expect(screen.getByTestId("note").textContent).toBe(
        "Couldn't fetch the stock price: trying again in a minute.",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("refetches the trades after a fill that stored something, not after one that stored nothing", async () => {
    const fetchMock = stubFill((tradeIds) => ({
      filled: 0,
      missing: tradeIds.map((tradeId) => ({ tradeId, reason: "too_recent" })),
      optionMissing: [],
      unavailable: null,
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const listed = vi.fn(async () => []);
    function Lists() {
      useQuery({ queryKey: ["trades"], queryFn: listed });
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Lists />
        <Page trade={scalp("t1")} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("note").textContent).toBe(
        "Alpaca shares prices 15 minutes late: trying again in a minute.",
      ),
    );
    expect(listed).toHaveBeenCalledTimes(1);
  });

  it("gives the reason Alpaca has no bar, or the server's own message", async () => {
    stubFill((tradeIds) => ({
      filled: 0,
      missing: tradeIds.map((tradeId) => ({ tradeId, reason: "no_bars" })),
      optionMissing: [],
      unavailable: null,
    }));
    renderPage(scalp("t1"));
    await waitFor(() =>
      expect(screen.getByTestId("note").textContent).toBe(
        "Alpaca has no stock price for the entry minute: type the stock at entry.",
      ),
    );
    vi.unstubAllGlobals();
    const message = "Add an Alpaca key in Settings to fetch the stock price.";
    stubFill(() => ({
      filled: 0,
      missing: [],
      optionMissing: [],
      unavailable: { reason: "no_key", message },
    }));
    renderPage(scalp("t9"));
    await waitFor(() => expect(screen.getAllByTestId("note").at(-1)?.textContent).toBe(message));
  });
});

function Backfill({ trades }: { trades: TradeView[] | undefined }) {
  const state = useBackfillPrices(trades);
  return <p data-testid="backfill">{`${state.fetching}|${state.problem ?? ""}`}</p>;
}

/** Renders the backfill under StrictMode, as the app does. */
function renderBackfill(trades: TradeView[] | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const ui = (next: TradeView[] | undefined) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <Backfill trades={next} />
      </QueryClientProvider>
    </StrictMode>
  );
  const view = render(ui(trades));
  return { rerender: (next: TradeView[] | undefined) => view.rerender(ui(next)) };
}

const backfill = () => screen.getByTestId("backfill").textContent;

describe("useBackfillPrices", () => {
  it("asks once, for every scalp still missing a price, and says how many while it runs", async () => {
    let answer: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const fly = { ...scalp("f"), strategy: "iron_fly" } as TradeView;
    const page = renderBackfill(undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    page.rerender([scalp("a"), scalp("b", FULL), fly, scalp("c", { ...FULL, holdHigh: null }, 2)]);
    await waitFor(() => expect(backfill()).toBe("2|"));
    expect(bodies(fetchMock)).toEqual([{ tradeIds: ["a", "c"] }]);
    answer(new Response(JSON.stringify(filledAll()), { headers: { "content-type": "application/json" } }));
    await waitFor(() => expect(backfill()).toBe("0|"));
    page.rerender([scalp("a"), scalp("d")]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks nothing when every scalp has its prices", async () => {
    const fetchMock = stubFill(filledAll);
    renderBackfill([scalp("a", FULL)]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(backfill()).toBe("0|");
  });

  it("sends at most 1,000 ids a request", async () => {
    const fetchMock = stubFill(filledAll);
    renderBackfill(Array.from({ length: 1001 }, (_, index) => scalp(`t${index}`)));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodies(fetchMock).map((body) => body.tradeIds.length)).toEqual([1000, 1]);
  });

  it("says why when there's no key, or the request fails", async () => {
    stubFill(() => ({
      filled: 0,
      missing: [],
      optionMissing: [],
      unavailable: { reason: "no_key", message: "Add an Alpaca key in Settings to fetch the stock price." },
    }));
    renderBackfill([scalp("a")]);
    await waitFor(() =>
      expect(backfill()).toBe("0|Add an Alpaca key in Settings to fetch the missing stock prices."),
    );
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    renderBackfill([scalp("b")]);
    await waitFor(() =>
      expect(screen.getAllByTestId("backfill").at(-1)?.textContent).toBe(
        "0|Couldn't fetch stock prices: reload to try again.",
      ),
    );
  });

  it("asks again a minute later for the scalps Alpaca's delay held back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubFill((tradeIds) => ({
      filled: 0,
      missing: tradeIds.filter((id) => id === "late").map((tradeId) => ({ tradeId, reason: "too_recent" })),
      optionMissing: [],
      unavailable: null,
    }));
    renderBackfill([scalp("early"), scalp("late")]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodies(fetchMock)).toEqual([{ tradeIds: ["early", "late"] }, { tradeIds: ["late"] }]);
  });
});
