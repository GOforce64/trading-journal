import { type MoveValue, sessionMoment, type TradeMoves, tradeMoves } from "@tj/core";
import type { ReactNode } from "react";
import type { TradeView } from "../api.js";
import { Tile, usd } from "../components/ui.js";
import {
  etMinute,
  ivPct,
  lastReason,
  movePct,
  type PriceSide,
  priceNote,
  useFilling,
  useFillMoves,
  useFillResults,
  useMarketOn,
} from "../moves.js";

const IV_BLANK = {
  near_expiry: "left blank within 24 h of expiry",
  unsolvable: "couldn't solve: price at intrinsic",
} as const;

/** The small print under a tile's value: how it was worked out, or what it's waiting for. */
function Working({ children }: { children: ReactNode }) {
  return <small className="mt-1 block font-normal text-[10px] text-muted">{children}</small>;
}

const typedText = (value: MoveValue, format: (fraction: number) => string) =>
  `typed${value.computed != null ? ` (computed ${format(value.computed)})` : ""}`;

function ivWorking(moves: TradeMoves): string {
  const { ivBefore, ivAfter } = moves;
  const notes: string[] = [];
  if (ivBefore && ivAfter) {
    // From the whole percentages the tile shows, so "123% → 77%" reads "crush 46 pts".
    const points = Math.round(ivBefore.value * 100) - Math.round(ivAfter.value * 100);
    notes.push(points >= 0 ? `crush ${points} pts` : `IV rose ${-points} pts`);
  }
  if (!ivBefore && moves.ivBeforeBlank) notes.push(`before ${IV_BLANK[moves.ivBeforeBlank]}`);
  if (!ivAfter && moves.ivAfterBlank) notes.push(`after ${IV_BLANK[moves.ivAfterBlank]}`);
  const shown = [ivBefore, ivAfter].filter((value): value is MoveValue => value != null);
  if (shown.length > 0)
    notes.push(shown.some((value) => value.source === "override") ? "typed" : "from your fills");
  return notes.join(" · ");
}

/** Implied move, actual move, IV before → after, and the stock prices they come from (spec §9.2). */
export function MoveTiles({ trade }: { trade: TradeView }) {
  const moves = tradeMoves(trade);
  const fetching = useFilling();
  const marketOn = useMarketOn();
  const results = useFillResults();
  const fill = useFillMoves();
  const { impliedMove, actualMove, moveRatio, ivBefore, ivAfter, stockAtEntry, stockAtExit } = moves;
  const open = trade.closedAt == null;
  const straddle = trade.legs.filter((leg) => leg.quantity < 0).reduce((sum, leg) => sum + leg.openPrice, 0);

  // Only the stock tile says why a price is missing; the others say what they need.
  const missingSide: PriceSide | null =
    stockAtEntry == null ? "entry" : !open && stockAtExit == null ? "exit" : null;
  const missingNote =
    missingSide &&
    priceNote({
      at: missingSide === "entry" ? trade.openedAt : (trade.closedAt ?? trade.openedAt),
      fetching,
      marketOn,
      lastReason: lastReason(results, trade.id, missingSide),
      now: Date.now(),
    });
  const readAt = `Alpaca, ${etMinute(sessionMoment(trade.openedAt))}${
    trade.closedAt != null ? ` → ${etMinute(sessionMoment(trade.closedAt))}` : ""
  } ET`;

  let impliedWorking = "";
  if (impliedMove) {
    impliedWorking =
      impliedMove.source === "override"
        ? typedText(impliedMove, (value) => movePct(value))
        : `straddle ${straddle.toFixed(2)} ÷ ${usd(stockAtEntry ?? 0)} at entry`;
  } else if (stockAtEntry == null) {
    impliedWorking = "needs the stock at entry";
  }

  let actualWorking = open ? "open" : "needs the stock at entry and exit";
  if (actualMove) {
    const source =
      actualMove.source === "override"
        ? typedText(actualMove, (value) => movePct(value, true))
        : `${usd(stockAtEntry ?? 0)} → ${usd(stockAtExit ?? 0)}`;
    actualWorking = moveRatio != null ? `${source} · ${moveRatio.toFixed(2)}× implied` : source;
  }

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Tile label="Implied move" testId="tile-implied-move" empty={!impliedMove}>
        {impliedMove ? movePct(impliedMove.value) : "—"}
        <Working>{impliedWorking}</Working>
      </Tile>
      <Tile label="Actual move" testId="tile-actual-move" empty={!actualMove}>
        {actualMove ? movePct(actualMove.value, true) : "—"}
        <Working>{actualWorking}</Working>
      </Tile>
      <Tile label="IV before → after" testId="tile-iv" empty={!ivBefore && !ivAfter}>
        {ivBefore || ivAfter
          ? `${ivBefore ? ivPct(ivBefore.value) : "—"} → ${ivAfter ? ivPct(ivAfter.value) : "—"}`
          : "—"}
        <Working>{ivWorking(moves) || (stockAtEntry == null ? "needs the stock at entry" : "")}</Working>
      </Tile>
      <Tile label="Stock at entry / exit" testId="tile-stock" empty={missingSide != null}>
        {stockAtEntry != null ? usd(stockAtEntry) : "—"} /{" "}
        {open ? "open" : stockAtExit != null ? usd(stockAtExit) : "—"}
        <Working>
          {missingNote ?? readAt}
          {missingSide && marketOn && !fetching && (
            <button type="button" onClick={() => fill.mutate([trade.id])} className="ml-2 text-accent">
              Fill in missing
            </button>
          )}
        </Working>
      </Tile>
    </div>
  );
}
