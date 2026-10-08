import { scalpRisk } from "@tj/core";
import { useEffect, useMemo, useState } from "react";
import type { TradeDetailView } from "../api.js";
import { barRange, useOptionBars } from "../chart/bars.js";
import {
  arriveBy,
  type ChartView,
  contractName,
  contractOf,
  optionBarsState,
  viewOf,
} from "../chart/option.js";
import { TradeCharts } from "../chart/TradeCharts.js";
import { LevelFields } from "./LevelFields.js";
import { approxLines, useLevels } from "./levels.js";
import { useAutoFillPrices } from "./prices.js";
import { QueueBar } from "./QueueBar.js";
import { ReviewPanel } from "./ReviewPanel.js";
import { RiskLine } from "./RiskLine.js";

/**
 * A scalp's queue bar, charts and review strip (scalp-review spec §7.1), sharing the stop and target, and the
 * Stock | Option view (premium-chart spec §6–7).
 */
export function ScalpWorkspace({
  trade,
  onOpenTrade,
}: {
  trade: TradeDetailView;
  onOpenTrade?: (id: string) => void;
}) {
  const contract = contractOf(trade);
  const { from, lastDay } = barRange(trade);
  const optionBars = useOptionBars(contract, from, lastDay);
  const optionState = optionBarsState(optionBars.data, trade.openedAt);
  const premiumChart = optionState === "ready";
  const levels = useLevels(trade, { premiumChart });
  const home = viewOf(levels.basis);
  const [view, setView] = useState<ChartView>(home);
  // The view follows the basis, and + Stop or + Target brings up the chart that places it (premium-chart spec §6.1, §7).
  useEffect(() => setView(home), [home]);
  useEffect(() => {
    if (levels.placing) setView(home);
  }, [levels.placing, home]);
  useAutoFillPrices(trade);
  // Priced where the lines are right now, so the strip follows a drag (scalp-R spec §9.2).
  const live = scalpRisk(trade, {
    basis: levels.basis,
    stop: levels.stop.shown,
    targets: levels.targets.shown,
  });
  const approx = approxLines(view === "option" && levels.basis === "stock" ? live : null);
  const approxKey = approx.map((line) => `${line.label}@${line.price}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the lines, which are rebuilt each render
  const approxShown = useMemo(() => approx, [approxKey]);
  // Only the basis's own view places and drags its levels; the other shows estimates, or nothing.
  const onHome = view === home;
  const chart = {
    lines: onHome ? levels.chart.lines : approxShown,
    editing: { ...levels.chart.editing, placing: onHome ? levels.chart.editing.placing : null },
  };
  const answer = optionBars.data;
  let premiumNote: string | null = null;
  if (levels.basis === "premium" && answer && optionState !== "ready") {
    premiumNote =
      optionState === "waiting"
        ? `The option chart's bars arrive by ${arriveBy(trade.openedAt, answer.delayMinutes)}: type the levels or wait.`
        : "No option bars for this contract: type the levels.";
  }
  return (
    <>
      <QueueBar trade={trade} onOpenTrade={onOpenTrade} />
      <TradeCharts
        trade={trade}
        levels={chart}
        option={contract ? { contract, name: contractName(trade), view, onView: setView } : undefined}
      />
      <ReviewPanel
        trade={trade}
        layout="strip"
        levels={
          <div className="flex flex-col gap-1.5">
            <LevelFields levels={levels} risk={live} premiumNote={premiumNote} />
            <RiskLine trade={trade} levels={levels} risk={live} />
          </div>
        }
      />
    </>
  );
}
