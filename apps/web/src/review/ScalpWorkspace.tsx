import type { TradeDetailView } from "../api.js";
import { TradeCharts } from "../chart/TradeCharts.js";
import { LevelFields } from "./LevelFields.js";
import { useLevels } from "./levels.js";
import { useAutoFillPrices } from "./prices.js";
import { QueueBar } from "./QueueBar.js";
import { ReviewPanel } from "./ReviewPanel.js";

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
  return (
    <>
      <QueueBar trade={trade} onOpenTrade={onOpenTrade} />
      <TradeCharts trade={trade} levels={levels.chart} />
      <ReviewPanel trade={trade} layout="strip" levels={<LevelFields levels={levels} />} />
    </>
  );
}
