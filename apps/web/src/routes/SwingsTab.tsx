import {
  type BreakdownContext,
  closedTrades,
  type SwingBreakdown,
  swingBreakdown,
  swingSummary,
} from "@tj/core";
import { useMemo } from "react";
import { BreakdownPanel } from "../analytics/Breakdown.js";
import { profitFactorText, shareText, winRateText } from "../analytics/format.js";
import { KpiStrip } from "../analytics/KpiStrip.js";
import { returnText } from "../analytics/scalpText.js";
import { Money } from "../components/ui.js";
import { type Setup, useSetups, useTags } from "../review/data.js";
import type { TabProps } from "./OverviewTab.js";

export const SWING_DIMENSIONS: readonly { id: SwingBreakdown; label: string }[] = [
  { id: "structure", label: "Structure" },
  { id: "held", label: "Days held" },
  { id: "dte", label: "DTE at open" },
  { id: "setup", label: "Setup" },
  { id: "ticker", label: "Ticker" },
  { id: "weekday", label: "Weekday" },
  { id: "grade", label: "Grade" },
  { id: "emotion", label: "Emotion" },
  { id: "book", label: "Book" },
  { id: "month", label: "Month" },
];

const NO_SETUPS: readonly Setup[] = [];
const daysText = (days: number | null) => (days == null ? "—" : `${days.toFixed(1)} days`);

/** Which swings work (swing spec §6.3): the KPI strip, then one breakdown at a time. */
export function SwingsTab({ trades, search, onSearch }: TabProps) {
  const swings = useMemo(() => closedTrades(trades.filter((trade) => trade.strategy === "swing")), [trades]);
  const { data: setups = NO_SETUPS } = useSetups();
  const { data: tags } = useTags();
  const context = useMemo<BreakdownContext>(
    () => ({
      setups: new Map(setups.map((setup) => [setup.id, setup.name])),
      emotions: new Map(
        (tags ?? []).filter((tag) => tag.kind === "emotion").map((tag) => [tag.id, tag.name]),
      ),
      costEdges: [],
      contractEdges: [],
    }),
    [setups, tags],
  );
  const by: SwingBreakdown = search.sby ?? "structure";
  const summary = useMemo(() => swingSummary(swings), [swings]);
  const rows = useMemo(() => swingBreakdown(swings, by, context), [swings, by, context]);
  const none = summary.trades === 0;
  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        kpis={[
          { id: "net", label: "Net P&L", value: none ? "—" : <Money value={summary.net} /> },
          { id: "swings", label: "Swings", value: summary.trades },
          { id: "win-rate", label: "Win rate", value: winRateText(summary.winRate) },
          { id: "profit-factor", label: "Profit factor", value: profitFactorText(summary.profitFactor) },
          {
            id: "avg-return",
            label: "Avg return",
            value: returnText(summary.avgReturn),
            sub: "on the debit",
          },
          { id: "avg-held", label: "Avg held", value: daysText(summary.avgDaysHeld) },
          {
            id: "avg-of-max",
            label: "Avg % of max",
            value: shareText(summary.avgPctOfMax),
            sub: none ? undefined : `${summary.spreads} of ${summary.trades} are spreads`,
          },
        ]}
      />
      {none ? (
        <p className="text-muted">No closed swings in this range.</p>
      ) : (
        <BreakdownPanel
          by={by}
          onBy={(next) => onSearch({ sby: next === "structure" ? undefined : next })}
          rows={rows}
          metric="net"
          dimensions={SWING_DIMENSIONS}
          withR={false}
        />
      )}
    </div>
  );
}
