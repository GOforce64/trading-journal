import { useQuery } from "@tanstack/react-query";
import { closeEstimate, type OptionQuote, pctKept, returnOnCost, round2 } from "@tj/core";
import { api, type TradeDetailView } from "../api.js";
import { TradeCharts } from "../chart/TradeCharts.js";
import { ESTIMATE_STYLE, EstimatedPnl, quotedAtText, signedUsd } from "../components/Estimate.js";
import { Chip, Money, Panel, Pct, premiumText, Tile, usd } from "../components/ui.js";
import { isOpen, openContracts, todayNy, useOptionQuotes } from "../market.js";
import { ReviewPanel } from "../review/ReviewPanel.js";
import { RiskTiles } from "../review/RiskTiles.js";
import { ScalpWorkspace } from "../review/ScalpWorkspace.js";
import { Screenshots } from "../screenshots/Screenshots.js";
import { FillsPanel } from "./FillsPanel.js";
import { MoveTiles } from "./MoveTiles.js";
import { ScalpTiles } from "./ScalpTiles.js";
import { SettlePanel } from "./SettlePanel.js";
import { SyncedBanner } from "./SyncedBanner.js";

/** Cash paid (positive) or received (negative) to open a leg. */
const legCost = (leg: { quantity: number; multiplier: number; openPrice: number }) =>
  round2(leg.quantity * leg.multiplier * leg.openPrice);

/** Realised P&L of a closed leg; null while it is still open. */
const legPnl = (leg: {
  quantity: number;
  multiplier: number;
  openPrice: number;
  closePrice: number | null;
}) =>
  leg.closePrice == null ? null : round2(leg.quantity * leg.multiplier * (leg.closePrice - leg.openPrice));

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const NO_QUOTES = new Map<string, OptionQuote>();

export function TradeDetail({
  tradeId,
  onEdit,
  onSettle,
  onOpenTrade,
}: {
  tradeId: string;
  onEdit?: (id: string) => void;
  onSettle?: (id: string) => void;
  /** Opens another trade: the queue bar's Next and Prev. */
  onOpenTrade?: (id: string) => void;
}) {
  const { data: trade, isLoading } = useQuery({
    queryKey: ["trade", tradeId],
    queryFn: async (): Promise<TradeDetailView> => {
      const res = await api.api.trades[":id"].$get({ param: { id: tradeId } });
      if (!res.ok) throw new Error(`load failed: ${res.status}`);
      return res.json();
    },
  });

  const today = todayNy();
  const { data: optionQuotes } = useOptionQuotes(trade && isOpen(trade) ? openContracts(trade, today) : []);

  if (isLoading || !trade) return <p className="text-muted">Loading…</p>;
  const metrics = trade.metrics;
  const detail = trade.ironFly;
  // What closing now would realise; shown, never stored (spec §9).
  const marketOn = optionQuotes?.available === true;
  const estimate = isOpen(trade) ? closeEstimate(trade, optionQuotes?.quotes ?? NO_QUOTES, today) : null;
  // Mark columns only when there are marks: not without a key, and not on an expired trade.
  const marked = estimate?.kind === "estimate" ? estimate : null;
  const markOf = (index: number) => marked?.legs.find((leg) => leg.index === index);
  const totalCost = round2(trade.legs.reduce((sum, leg) => sum + legCost(leg), 0));
  const closedLegPnl = trade.legs.map(legPnl).filter((value): value is number => value !== null);
  const totalLegPnl = closedLegPnl.length
    ? round2(closedLegPnl.reduce((sum, value) => sum + value, 0))
    : null;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="num font-semibold text-[16px]">{trade.underlying}</h1>
        <span className="text-muted">{trade.underlyingName}</span>
        <Chip tone={trade.strategy}>{trade.structureLabel ?? "IRON FLY"}</Chip>
        <Chip tone={trade.book}>{trade.book.toUpperCase()}</Chip>
        {trade.excluded && <Chip tone="excluded">EXCLUDED</Chip>}
        <span className="num text-muted">
          {ET.format(new Date(trade.openedAt))}
          {trade.closedAt ? ` → ${ET.format(new Date(trade.closedAt))}` : ""}
        </span>
        <span className="ml-auto text-[18px]">
          {estimate ? (
            <EstimatedPnl estimate={estimate} testId="header-estimate" explain={marketOn} />
          ) : (
            <Money value={trade.netPnl} />
          )}
        </span>
        {/* A fly's P&L against max profit (its metrics need both wings, % kept doesn't); a scalp's return on cost. */}
        <span data-testid="header-pct" className="text-[18px]">
          <Pct
            value={
              trade.strategy === "scalp" ? returnOnCost(trade) : (metrics?.pnlPctOfCost ?? pctKept(trade))
            }
          />
        </span>
        <button
          type="button"
          onClick={() => onEdit?.(trade.id)}
          className="rounded-sm border border-line bg-panel px-3 py-1 text-fg hover:border-accent"
        >
          Edit
        </button>
      </header>
      <SyncedBanner trade={trade} />
      {trade.strategy === "scalp" ? (
        <ScalpWorkspace trade={trade} onOpenTrade={onOpenTrade} />
      ) : (
        <TradeCharts trade={trade} />
      )}

      {trade.strategy === "iron_fly" ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Tile label="Structure" testId="tile-structure">
            {metrics
              ? `${detail?.putWingStrike} / ${detail?.bodyPutStrike} / ${detail?.callWingStrike}`
              : "—"}
            <small className="mt-1 block text-[10px] text-muted">
              put wing {metrics?.putWingWidth} · call wing {metrics?.callWingWidth}
              {metrics?.isBrokenWing ? " · broken" : ""}
            </small>
          </Tile>
          <Tile label="Max profit">{metrics ? usd(metrics.maxProfit) : "—"}</Tile>
          <Tile label="Max loss" testId="tile-max-loss">
            {metrics ? usd(metrics.maxLoss) : "—"}
            <small className="mt-1 block text-[10px] text-muted">
              {metrics
                ? `${metrics.riskySide} side · other side ${usd(
                    metrics.riskySide === "call" ? metrics.putSideRisk : metrics.callSideRisk,
                  )}`
                : ""}
            </small>
          </Tile>
          <Tile label="% kept" testId="tile-kept">
            <Pct value={pctKept(trade)} />
          </Tile>
          <Tile label="Breakevens" testId="tile-breakevens">
            {metrics ? `${metrics.breakevenLow} / ${metrics.breakevenHigh}` : "—"}
          </Tile>
        </div>
      ) : (
        <>
          <ScalpTiles trade={trade} />
          <RiskTiles trade={trade} />
        </>
      )}

      {trade.strategy === "iron_fly" && <MoveTiles trade={trade} />}
      {trade.strategy === "iron_fly" &&
        estimate?.kind === "expired" &&
        // A synced fly the user hasn't changed is settled by the sync, from the next Activity statement's expiry
        // bookings; settling it here would freeze it at the close, not at when it really closed.
        (trade.source === "ibkr_flex" && trade.factsEditedAt == null ? (
          <p className="text-[11px] text-muted">
            IBKR books the expiry overnight: the next sync closes this trade at its expiry values.
          </p>
        ) : (
          <SettlePanel trade={trade} onEdit={onEdit} onEditSettled={onSettle} />
        ))}

      <div className={`grid gap-3 ${trade.strategy === "iron_fly" ? "lg:grid-cols-[1.35fr_1fr]" : ""}`}>
        <Panel title="Legs">
          <div
            data-testid="legs-total"
            className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-line border-b pb-2 font-semibold text-[12px]"
          >
            <span className="text-muted uppercase tracking-wider">Total</span>
            <span>
              <span className="mr-1 text-[10px] text-muted uppercase">cost</span>
              <Money value={totalCost} />
            </span>
            <span>
              <span className="mr-1 text-[10px] text-muted uppercase">legs P&amp;L</span>
              <Money value={totalLegPnl} />
            </span>
            <span>
              <span className="mr-1 text-[10px] text-muted uppercase">fees</span>
              <span className="num">{usd(trade.fees)}</span>
            </span>
            <span>
              <span className="mr-1 text-[10px] text-muted uppercase">net</span>
              <Money value={trade.netPnl} />
            </span>
          </div>
          <table className="num w-full border-collapse text-[11px]">
            <thead className="text-[9px] text-muted uppercase tracking-wider">
              <tr>
                <th className="text-left font-medium">Side</th>
                <th className="text-left font-medium">Type</th>
                <th className="text-left font-medium">Strike</th>
                <th className="text-left font-medium">Exp</th>
                <th className="text-right font-medium">Size</th>
                <th className="text-right font-medium">Open</th>
                <th className="text-right font-medium">Close</th>
                <th className="text-right font-medium">Cost</th>
                <th className="text-right font-medium">P&amp;L</th>
                {marked && (
                  <>
                    <th className="text-right font-medium">Mark (to close)</th>
                    <th className="text-right font-medium">Est. P&amp;L</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {trade.legs.map((leg, index) => {
                const mark = markOf(index);
                return (
                  <tr key={leg.id} data-testid={`leg-row-${leg.id}`} className="border-line border-t">
                    <td className={leg.quantity < 0 ? "text-down" : "text-up"}>
                      {leg.quantity < 0 ? "SHORT" : "LONG"}
                    </td>
                    <td>{leg.right === "C" ? "Call" : "Put"}</td>
                    <td>{leg.strike.toFixed(2)}</td>
                    <td>{leg.expiry.slice(5)}</td>
                    <td className="text-right">{leg.quantity}</td>
                    <td className="text-right">{premiumText(leg.openPrice)}</td>
                    <td className="text-right">
                      {leg.closePrice == null ? "—" : premiumText(leg.closePrice)}
                    </td>
                    <td className="text-right">
                      <Money value={legCost(leg)} />
                    </td>
                    <td className="text-right">
                      <Money value={legPnl(leg)} />
                    </td>
                    {marked && (
                      <>
                        <td className={`text-right ${ESTIMATE_STYLE}`}>
                          {mark ? `${mark.mark.toFixed(2)} ${mark.side}` : "—"}
                        </td>
                        <td className={`text-right ${ESTIMATE_STYLE}`}>{mark ? signedUsd(mark.pnl) : "—"}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {estimate?.kind === "estimate" && (
            <p data-testid="estimate-note" className="mt-2 text-[10px] text-muted">
              Estimate {signedUsd(estimate.grossPnl)} before fees, {signedUsd(estimate.netPnl)} after the{" "}
              {usd(estimate.fees)} fees entered so far (exit fees not included). Quotes as of{" "}
              {quotedAtText(estimate.quotedAt)} · indicative feed · refreshes every minute · never saved.
            </p>
          )}
          {marketOn && estimate?.kind === "unavailable" && (
            <p className="mt-2 text-[10px] text-muted">Marks unavailable: {estimate.reason}.</p>
          )}
          {detail?.sourceNotes && (
            <>
              <div className="mt-3 text-[10px] text-muted uppercase tracking-wider">Source notes</div>
              <p className="rounded-sm border border-line bg-[#0e1118] p-2">{detail.sourceNotes}</p>
            </>
          )}
        </Panel>

        {trade.strategy === "iron_fly" && <ReviewPanel trade={trade} layout="side" />}
      </div>
      <FillsPanel fills={trade.fills ?? []} />
      <Screenshots trade={{ id: trade.id, attachments: trade.attachments ?? [] }} />
    </div>
  );
}
