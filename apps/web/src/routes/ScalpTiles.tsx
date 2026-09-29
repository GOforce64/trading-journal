import type { TradeView } from "../api.js";
import { Pct, Tile } from "../components/ui.js";

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
/** Up to 4 decimals, trailing zeros dropped: 1.06, 1.295. */
const price = (value: number) => String(Number(value.toFixed(4)));
const expiryText = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** How long a trade was held: "15 min", "3 h 20 min", "2 d 4 h". */
export function heldText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

/** A scalp's tiles (spec §9.5): one contract, bought and sold. */
export function ScalpTiles({ trade }: { trade: TradeView }) {
  const leg = trade.legs[0];
  const contracts = leg ? Math.abs(leg.quantity) : 0;
  const cost = leg ? contracts * leg.multiplier * leg.openPrice : 0;
  const returnOnCost = trade.netPnl != null && cost > 0 ? trade.netPnl / cost : null;
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
      <Tile label="Contract" testId="tile-contract">
        {leg
          ? `${trade.underlying} ${leg.strike}${leg.right} · exp ${expiryText(leg.expiry)}`
          : trade.underlying}
      </Tile>
      <Tile label="Size" testId="tile-size">
        {contracts} contract{contracts === 1 ? "" : "s"}
      </Tile>
      <Tile label="Entry → exit" testId="tile-entry-exit">
        {leg ? `${price(leg.openPrice)} → ${leg.closePrice == null ? "open" : price(leg.closePrice)}` : "—"}
      </Tile>
      <Tile label="Held" testId="tile-held">
        {trade.closedAt == null ? "open" : heldText(trade.closedAt - trade.openedAt)}
      </Tile>
      <Tile label="Fees" testId="tile-fees">
        {usd(trade.fees)}
      </Tile>
      <Tile label="Return on cost" testId="tile-return">
        <Pct value={returnOnCost} />
      </Tile>
    </div>
  );
}
