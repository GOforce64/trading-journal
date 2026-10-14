import { dayYearText, swingMetrics } from "@tj/core";
import type { ReactNode } from "react";
import type { TradeView } from "../api.js";
import { ESTIMATE_STYLE } from "../components/Estimate.js";
import { Pct, premiumText, Tile, usd } from "../components/ui.js";

const count = (value: number, word: string) => `${value} ${word}${value === 1 ? "" : "s"}`;
const Sub = ({ children }: { children: ReactNode }) => (
  <small className="mt-1 block text-[10px] text-muted">{children}</small>
);

/**
 * A swing's tiles (swing spec §5.5): the debit, a spread's max profit, the break-even, % of max (a spread) or the
 * return on debit (a single option), and how long it's been held. While open, the % is the live estimate's.
 */
export function SwingTiles({
  trade,
  today,
  estimatedPnl,
}: {
  trade: TradeView;
  today: string;
  /** The open trade's estimated net P&L from live marks; null without one. */
  estimatedPnl: number | null;
}) {
  const metrics = swingMetrics(trade, today);
  if (!metrics) return null;
  const spread = metrics.maxProfit != null;
  const base = spread ? metrics.maxProfit : metrics.debit;
  const settled = spread ? metrics.pctOfMax : metrics.returnOnDebit;
  const estimated = settled == null && estimatedPnl != null && base ? estimatedPnl / base : null;
  return (
    <div className={`grid grid-cols-2 gap-2 ${spread ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
      <Tile label="Debit" testId="tile-debit">
        {usd(metrics.debit)}
        <Sub>
          {premiumText(metrics.debitPerShare)} × {metrics.contracts}
        </Sub>
      </Tile>
      {spread && (
        <Tile label="Max profit" testId="tile-max-profit">
          {usd(metrics.maxProfit ?? 0)}
          <Sub>width {metrics.width}</Sub>
        </Tile>
      )}
      <Tile label="Break-even" testId="tile-break-even">
        {metrics.breakEven.toFixed(2)}
      </Tile>
      <Tile label={spread ? "% of max" : "Return on debit"} testId={spread ? "tile-pct-max" : "tile-return"}>
        {estimated != null ? (
          <span className={ESTIMATE_STYLE}>
            <Pct value={estimated} />
          </span>
        ) : (
          <Pct value={settled} />
        )}
      </Tile>
      <Tile label="Held" testId="tile-held">
        {count(metrics.daysHeld, "day")}
        <Sub>{count(metrics.sessionsHeld, "session")}</Sub>
      </Tile>
      <Tile label="DTE at open" testId="tile-dte">
        {metrics.dteAtOpen}
        <Sub>{dayYearText(metrics.expiry)}</Sub>
      </Tile>
    </div>
  );
}
