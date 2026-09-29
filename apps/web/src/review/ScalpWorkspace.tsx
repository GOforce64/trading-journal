import type { TradeDetailView } from "../api.js";
import { TradeCharts } from "../chart/TradeCharts.js";
import { LevelFields } from "./LevelFields.js";
import { useLevels } from "./levels.js";
import { ReviewPanel } from "./ReviewPanel.js";

/** A scalp's charts and its review strip (scalp-review spec §7.1), sharing the stop and target. */
export function ScalpWorkspace({ trade }: { trade: TradeDetailView }) {
  const levels = useLevels(trade);
  return (
    <>
      <TradeCharts trade={trade} levels={levels.chart} />
      <ReviewPanel trade={trade} layout="strip" levels={<LevelFields levels={levels} />} />
    </>
  );
}
