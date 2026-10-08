import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { nyWallClock, type RiskTrade, scalpRisk } from "@tj/core";
import { describe, expect, it } from "vitest";
import type { TradeView } from "../api.js";
import { RiskTiles } from "./RiskTiles.js";

type Levels = NonNullable<RiskTrade["scalp"]>;

/** The Sep 28 NVDA scalp (scalp-R spec §1). */
function nvda(trade: Partial<RiskTrade> = {}, levels: Partial<Levels> = {}): RiskTrade {
  return {
    strategy: "scalp",
    openedAt: nyWallClock("2026-09-28", 571) + 5_000,
    closedAt: nyWallClock("2026-09-28", 586) + 12_000,
    netPnl: 44.74,
    legs: [
      { right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2, multiplier: 100, openPrice: 1.06 },
    ],
    scalp: {
      levelBasis: "stock",
      stopPrice: 229,
      stockEntryOverride: null,
      riskOverride: null,
      targets: [
        { price: 233, contracts: 1 },
        { price: 234.5, contracts: 1 },
      ],
      ...levels,
    },
    scalpPrices: { entryPrice: 230.78 + (231.355 - 230.78) * (5 / 60), holdHigh: 233.21, holdLow: 230.71 },
    ...trade,
  };
}

/** The tiles for a trade, with `risk` worked out as the server does. */
function renderTiles(trade: RiskTrade) {
  const view = { ...trade, id: "t1", risk: scalpRisk(trade) } as unknown as TradeView;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RiskTiles trade={view} />
    </QueryClientProvider>,
  );
}

const tile = (id: string) => screen.getByTestId(`tile-${id}`).textContent;

describe("RiskTiles", () => {
  it("shows the worked example's six tiles, and how the stop was priced", () => {
    renderTiles(nvda());
    expect(tile("planned-risk")).toBe("$104.05option 1.06 → 0.54 at the stop");
    expect(tile("r")).toBe("+0.43R+$44.74 ÷ $104.05");
    expect(tile("rr")).toBe("2.8reward $288.61 over 2 targets");
    expect(tile("mae")).toBe("−0.12−0.06R · stock low 230.71");
    expect(tile("mfe")).toBe("+2.38+1.30R · stock high 233.21");
    expect(tile("model")).toBe("IV 70.4%stock 230.83 · 6 h 29 min left");
    expect(screen.getByText(/^Black-Scholes, the stock jumping straight to the stop\./)).toBeTruthy();
    expect(screen.queryByTestId("risk-reason")).toBeNull();
  });

  it("reads — without a planned risk, with the reason in one line", () => {
    renderTiles(nvda({}, { stopPrice: null }));
    expect(tile("planned-risk")).toBe("—");
    expect(tile("r")).toBe("—");
    expect(tile("rr")).toBe("—reward $288.61 over 2 targets");
    expect(tile("model")).toBe("IV 70.4%stock 230.83 · 6 h 29 min left");
    expect(screen.getByTestId("risk-reason").textContent).toBe("Set a stop in the review strip to get R.");
  });

  it("says it's fetching the stock price while there's none", () => {
    renderTiles(nvda({ scalpPrices: null }));
    expect(screen.getByTestId("risk-reason").textContent).toBe("Fetching the stock price…");
  });

  it("says why MAE and MFE wait for the hold's range, rather than only that they need it", () => {
    renderTiles(nvda({ scalpPrices: { entryPrice: 230.83, holdHigh: null, holdLow: null } }));
    expect(tile("mae")).toBe("—fetching the stock's range…");
    expect(tile("mfe")).toBe("—fetching the stock's range…");
  });

  it("says MAE and MFE run from the entry minute, and on premium waits for the option's range", () => {
    renderTiles(nvda({}, { levelBasis: "premium", stopPrice: 0.6 }));
    const tip =
      "From the entry minute through the exit minute. Trades in your entry minute before your fill count too.";
    expect(screen.getByTestId("tile-mae").parentElement?.getAttribute("title")).toBe(tip);
    expect(screen.getByTestId("tile-mfe").parentElement?.getAttribute("title")).toBe(tip);
    expect(tile("mae")).toBe("—fetching the option's range…");
  });

  it("shows nothing for a trade without R", () => {
    renderTiles(nvda({ strategy: "iron_fly" }));
    expect(screen.queryByTestId("tile-r")).toBeNull();
  });
});
