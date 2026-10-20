import { cleanup, render, screen } from "@testing-library/react";
import { nyWallClock } from "@tj/core";
import { afterEach, describe, expect, it } from "vitest";
import type { TradeView } from "../api.js";
import { SwingTiles } from "./SwingTiles.js";

const leg = (strike: number, quantity: number, openPrice: number) => ({
  id: `leg-${strike}`,
  right: "C",
  strike,
  expiry: "2026-11-06",
  quantity,
  multiplier: 100,
  openPrice,
  closePrice: null,
});
/** A swing opened on Friday 2 Oct 2026 and still open. */
const open = (legs: ReturnType<typeof leg>[]) =>
  ({
    strategy: "swing",
    openedAt: nyWallClock("2026-10-02", 615),
    closedAt: null,
    netPnl: null,
    legs,
  }) as unknown as TradeView;
const text = (testId: string) => screen.getByTestId(testId).textContent ?? "";

afterEach(cleanup);

describe("SwingTiles on an open swing (swing spec §9)", () => {
  it("shows an open spread's live estimate as % of max, and the days held to today", () => {
    // Debit 3.80 a share: $380, and $620 of max profit on the 10-wide spread; +$155 now is 25% of it.
    render(
      <SwingTiles
        trade={open([leg(230, 1, 5.1), leg(240, -1, 1.3)])}
        today="2026-10-09"
        estimatedPnl={155}
      />,
    );
    expect(text("tile-debit")).toContain("$380.00");
    expect(text("tile-max-profit")).toContain("$620.00");
    const pct = screen.getByTestId("tile-pct-max");
    expect(pct.textContent).toContain("25.00%");
    expect(pct.querySelector(".italic")).not.toBeNull();
    // Fri 2 Oct to Fri 9 Oct: 7 days, and the 5 sessions after the open.
    expect(text("tile-held")).toContain("7 days");
    expect(text("tile-held")).toContain("5 sessions");
  });

  it("shows no return on an open single option without live marks", () => {
    render(<SwingTiles trade={open([leg(230, 2, 5)])} today="2026-10-05" estimatedPnl={null} />);
    expect(text("tile-debit")).toContain("$1,000.00");
    expect(screen.queryByTestId("tile-max-profit")).toBeNull();
    expect(text("tile-return")).toContain("—");
    expect(text("tile-held")).toContain("3 days");
  });
});
