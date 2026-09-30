import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import type { Setup } from "../review/data.js";
import { SetupCards } from "./SetupCards.js";
import { SCALP_ROWS, SCALP_SETUPS } from "./scalps.fixture.js";
import { tradeRow } from "./testing.js";

const SETUPS = [
  ...SCALP_SETUPS,
  {
    id: "crush",
    name: "Earnings IV crush",
    strategy: "iron_fly",
    description: "Sell the ATM fly into earnings",
    archived: false,
    tradeCount: 2,
  },
  { id: "old", name: "Old setup", strategy: null, description: null, archived: true, tradeCount: 1 },
] as Setup[];

/* Two 1-lot flies of last year, each with a max profit of 204 − 4 = $200: +100 and −50 keep 50 ÷ 400 = 12.5%. */
const FLIES = [
  tradeRow({
    id: "f2",
    underlying: "BB",
    opened: "2025-09-09 15:50",
    closed: "2025-09-10 09:45",
    netPnl: 100,
    setupId: "crush",
  }),
  tradeRow({
    id: "f3",
    underlying: "CC",
    opened: "2025-09-16 15:50",
    closed: "2025-09-17 09:45",
    netPnl: -50,
    setupId: "crush",
  }),
];
const OLD = tradeRow({
  id: "o1",
  strategy: "scalp",
  underlying: "AMD",
  opened: "2026-09-21 09:40",
  closed: "2026-09-21 09:45",
  netPnl: 20,
  setupId: "old",
});
const EXCLUDED = tradeRow({
  id: "x1",
  strategy: "scalp",
  underlying: "NVDA",
  opened: "2026-09-22 09:40",
  closed: "2026-09-22 09:45",
  netPnl: 999,
  setupId: "orb",
  excluded: true,
});
const TRADES = [...SCALP_ROWS, ...FLIES, OLD, EXCLUDED] as unknown as TradeView[];

function renderCards(props: Partial<Parameters<typeof SetupCards>[0]> = {}) {
  const onOpenSetup = vi.fn();
  render(
    <SetupCards
      trades={TRADES}
      setups={SETUPS}
      showArchived={false}
      onOpenSetup={onOpenSetup}
      today="2026-09-30"
      {...props}
    />,
  );
  return onOpenSetup;
}

const card = (name: string) => within(screen.getByRole("article", { name }));
const titles = (name: string) =>
  [...(screen.getByRole("article", { name }).querySelectorAll("circle title") ?? [])].map(
    (title) => title.textContent,
  );

describe("SetupCards", () => {
  it("makes a card per setup with closed trades, most trades first, leaving excluded trades out", () => {
    renderCards();
    expect(screen.getAllByRole("article").map((each) => each.getAttribute("aria-label"))).toEqual([
      "ORB breakout",
      "Earnings IV crush",
      "VWAP reclaim",
    ]);
  });

  it("leads a scalp setup's card with Avg R and its cumulative R, and opens its Scalps tab", () => {
    const onOpenSetup = renderCards();
    const orb = card("ORB breakout");
    expect(orb.getByTestId("card-hero").textContent).toBe("+0.17R");
    expect(orb.getByText("over 3 of 3")).toBeTruthy();
    expect(orb.getByText("Win %").nextSibling?.textContent).toBe("33.3%");
    expect(orb.getByText("Net").nextSibling?.textContent).toBe("+$50");
    expect(orb.getByText("Avg return").nextSibling?.textContent).toBe("+8.3%");
    expect(orb.getByText("last Sep 29")).toBeTruthy();
    expect(titles("ORB breakout")).toEqual([
      "Sep 28 · NVDA · +1.00R · total +1.00R",
      "Sep 28 · NVDA · −0.50R · total +0.50R",
      "Sep 29 · SPY · 0.00R · total +0.50R",
    ]);
    expect(orb.getByTestId("sparkline").getAttribute("class")).toBe("stroke-up");
    fireEvent.click(orb.getByRole("button", { name: "3 trades →" }));
    expect(onOpenSetup).toHaveBeenCalledWith("orb", "scalps");
  });

  it("keeps each stat's label on one line, so a narrow card at 1024 px still lines them up", () => {
    renderCards();
    const orb = card("ORB breakout");
    for (const label of ["Trades", "Win %", "Net", "Avg return"]) {
      expect(orb.getByText(label).className).toContain("whitespace-nowrap");
    }
  });

  it("leaves the sparkline out with fewer than 2 points", () => {
    renderCards();
    const vwap = card("VWAP reclaim");
    expect(vwap.getByTestId("card-hero").textContent).toBe("—");
    expect(vwap.getByText("over 0 of 1")).toBeTruthy();
    expect(vwap.queryByTestId("sparkline")).toBeNull();
    expect(vwap.getByRole("button", { name: "1 trade →" })).toBeTruthy();
  });

  it("leads a fly setup's card with % kept and its cumulative net, and opens its Iron flies tab", () => {
    const onOpenSetup = renderCards();
    const crush = card("Earnings IV crush");
    expect(crush.getByTestId("card-hero").textContent).toBe("13%");
    expect(crush.getByText("of max profit")).toBeTruthy();
    expect(crush.getByText("PF").nextSibling?.textContent).toBe("2.00");
    expect(crush.getByText("last Sep 17, 2025")).toBeTruthy();
    expect(titles("Earnings IV crush")).toEqual([
      "Sep 10 · BB · +$100 · total +$100",
      "Sep 17 · CC · −$50 · total +$50",
    ]);
    fireEvent.click(crush.getByRole("button", { name: "2 trades →" }));
    expect(onOpenSetup).toHaveBeenCalledWith("crush", "flies");
  });

  it("shows archived setups' cards only on request", () => {
    renderCards({ showArchived: true });
    expect(card("Old setup").getByText("Both")).toBeTruthy();
  });

  it("says so when the trades or setups couldn't load, and waits for the setups before saying there are none", () => {
    const { rerender } = render(
      <SetupCards trades={undefined} setups={SETUPS} showArchived={false} failed />,
    );
    expect(screen.getByText("Couldn't load the setups' trades: reload to try again.")).toBeTruthy();
    rerender(<SetupCards trades={TRADES} setups={[]} showArchived={false} setupsLoading />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("Tag trades with a setup to see its stats here.")).toBeNull();
  });

  it("says what to do without cards, and waits for the trades", () => {
    const open = tradeRow({
      id: "open",
      strategy: "scalp",
      underlying: "NVDA",
      opened: "2026-09-29 09:40",
      closed: null,
      netPnl: null,
      setupId: "orb",
    });
    // A setup whose only trade is still open gets no card.
    const { rerender } = render(
      <SetupCards trades={[open] as unknown as TradeView[]} setups={SETUPS} showArchived={false} />,
    );
    expect(screen.getByText("Tag trades with a setup to see its stats here.")).toBeTruthy();
    rerender(<SetupCards trades={undefined} setups={SETUPS} showArchived={false} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});
