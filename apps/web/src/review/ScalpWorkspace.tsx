import { scalpRisk } from "@tj/core";
import type { TradeDetailView } from "../api.js";
import { TradeCharts } from "../chart/TradeCharts.js";
import { LevelFields } from "./LevelFields.js";
import { useLevels } from "./levels.js";
import { useAutoFillPrices } from "./prices.js";
import { QueueBar } from "./QueueBar.js";
import { ReviewPanel } from "./ReviewPanel.js";
import { RiskLine } from "./RiskLine.js";

/** A scalp's queue bar, charts and review strip (scalp-review spec §7.1), sharing the stop and target. */
export function ScalpWorkspace({
  trade,
  onOpenTrade,
}: {
  trade: TradeDetailView;
  onOpenTrade?: (id: string) => void;
}) {
  const levels = useLevels(trade);
  useAutoFillPrices(trade);
  // Priced where the lines are right now, so the strip follows a drag (scalp-R spec §9.2).
  const live = scalpRisk(trade, {
    basis: levels.basis,
    stop: levels.stop.shown,
    targets: levels.targets.shown,
  });
  return (
    <>
      <QueueBar trade={trade} onOpenTrade={onOpenTrade} />
      <TradeCharts trade={trade} levels={levels.chart} />
      <ReviewPanel
        trade={trade}
        layout="strip"
        levels={
          <div className="flex flex-col gap-1.5">
            <LevelFields levels={levels} risk={live} />
            <RiskLine trade={trade} levels={levels} risk={live} />
          </div>
        }
      />
    </>
  );
}
