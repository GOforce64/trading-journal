import type { ReactNode } from "react";
import type { TradeView } from "../api.js";
import { Tile } from "../components/ui.js";
import { OPTION_EPOCH, OPTION_RANGE_COPY, useOptionRangeNote, usePriceNote, useRangeNote } from "./prices.js";
import { modelNote, problemText, type RiskTileKey, riskTileText } from "./riskText.js";

/** The small print under a tile's value. */
function Working({ children }: { children: ReactNode }) {
  return <small className="mt-1 block font-normal text-[10px] text-muted">{children}</small>;
}

/** A minute bar can't tell which trades came first (premium-chart spec §9.4). */
const EXCURSION_TIP =
  "From the entry minute through the exit minute. Trades in your entry minute before your fill count too.";

const TILES: { key: RiskTileKey; label: string; testId: string; title?: string }[] = [
  { key: "risk", label: "Planned risk", testId: "tile-planned-risk" },
  { key: "r", label: "R", testId: "tile-r" },
  { key: "rewardRisk", label: "R:R planned", testId: "tile-rr" },
  { key: "mae", label: "MAE", testId: "tile-mae", title: EXCURSION_TIP },
  { key: "mfe", label: "MFE", testId: "tile-mfe", title: EXCURSION_TIP },
  { key: "model", label: "Model", testId: "tile-model" },
];

/**
 * A scalp's R row, under its tiles (scalp-R spec §9.1). It reads the server's `risk`, which is what's saved; the
 * strip's live line follows a line mid-drag.
 */
export function RiskTiles({ trade }: { trade: TradeView }) {
  const note = usePriceNote(trade.id);
  const rangeNote = useRangeNote(trade.id);
  const optionNote = useOptionRangeNote(trade.id);
  const risk = trade.risk;
  if (!risk) return null;
  let excursionNote = rangeNote;
  if (risk.basis === "premium") {
    excursionNote = trade.openedAt < OPTION_EPOCH ? OPTION_RANGE_COPY.too_old : optionNote;
  }
  const text = riskTileText(risk, trade, excursionNote);
  const reason = risk.plannedRisk == null ? problemText(risk, note) : null;
  const footnote = modelNote(risk);
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        {TILES.map((tile) => (
          <Tile
            key={tile.key}
            label={tile.label}
            testId={tile.testId}
            title={tile.title}
            empty={text[tile.key].value === "—"}
          >
            {text[tile.key].value}
            {text[tile.key].working && <Working>{text[tile.key].working}</Working>}
          </Tile>
        ))}
      </div>
      {reason && (
        <p data-testid="risk-reason" className="text-[11px] text-muted">
          {reason}
        </p>
      )}
      {footnote && <p className="text-[10px] text-muted">{footnote}</p>}
    </div>
  );
}
