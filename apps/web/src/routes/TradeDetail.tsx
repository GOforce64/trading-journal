import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { round2 } from "@tj/core";
import type { ReactNode } from "react";
import { api, type TradeView } from "../api.js";
import { Chip, Money, Panel, Pct } from "../components/ui.js";

const GRADES = ["A", "B", "C", "D", "F"] as const;
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

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

export function TradeDetail({ tradeId }: { tradeId: string }) {
  const queryClient = useQueryClient();

  const { data: trade, isLoading } = useQuery({
    queryKey: ["trade", tradeId],
    queryFn: async (): Promise<TradeView> => {
      const res = await api.api.trades[":id"].$get({ param: { id: tradeId } });
      if (!res.ok) throw new Error(`load failed: ${res.status}`);
      return res.json();
    },
  });

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await api.api.trades[":id"].$patch({ param: { id: tradeId }, json: body });
      if (!res.ok) throw new Error(`patch failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trade", tradeId] }),
  });

  if (isLoading || !trade) return <p className="text-muted">Loading…</p>;
  const metrics = trade.metrics;
  const detail = trade.ironFly;
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
          <Money value={trade.netPnl} />
        </span>
        <span className="text-[18px]">
          <Pct value={metrics?.pnlPctOfCost ?? null} />
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label="Structure" testId="tile-structure">
          {metrics ? `${detail?.putWingStrike} / ${detail?.bodyPutStrike} / ${detail?.callWingStrike}` : "—"}
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
        <Tile label="Return on risk">{metrics ? <Pct value={metrics.returnOnRisk} /> : "—"}</Tile>
        <Tile label="Breakevens" testId="tile-breakevens">
          {metrics ? `${metrics.breakevenLow} / ${metrics.breakevenHigh}` : "—"}
        </Tile>
        <Tile label="Implied move" testId="tile-implied-move" empty={detail?.impliedMovePct == null}>
          {detail?.impliedMovePct != null ? `${detail.impliedMovePct}%` : "— add"}
        </Tile>
        <Tile label="Actual move" empty={detail?.actualMovePct == null}>
          {detail?.actualMovePct != null ? `${detail.actualMovePct}%` : "— add"}
        </Tile>
        <Tile label="IV before → after" empty={detail?.ivBefore == null}>
          {detail?.ivBefore != null ? `${detail.ivBefore}% → ${detail.ivAfter ?? "—"}%` : "— add"}
        </Tile>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
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
              </tr>
            </thead>
            <tbody>
              {trade.legs.map((leg) => (
                <tr key={leg.id} data-testid={`leg-row-${leg.id}`} className="border-line border-t">
                  <td className={leg.quantity < 0 ? "text-down" : "text-up"}>
                    {leg.quantity < 0 ? "SHORT" : "LONG"}
                  </td>
                  <td>{leg.right === "C" ? "Call" : "Put"}</td>
                  <td>{leg.strike.toFixed(2)}</td>
                  <td>{leg.expiry.slice(5)}</td>
                  <td className="text-right">{leg.quantity}</td>
                  <td className="text-right">{leg.openPrice.toFixed(2)}</td>
                  <td className="text-right">{leg.closePrice?.toFixed(2) ?? "—"}</td>
                  <td className="text-right">
                    <Money value={legCost(leg)} />
                  </td>
                  <td className="text-right">
                    <Money value={legPnl(leg)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail?.sourceNotes && (
            <>
              <div className="mt-3 text-[10px] text-muted uppercase tracking-wider">Source notes</div>
              <p className="rounded-sm border border-line bg-[#0e1118] p-2">{detail.sourceNotes}</p>
            </>
          )}
        </Panel>

        <Panel title="Review">
          <div className="mb-2 flex gap-1">
            {GRADES.map((grade) => (
              <button
                key={grade}
                type="button"
                onClick={() => patch.mutate({ grade })}
                className={`num w-6 rounded-[2px] border py-0.5 ${
                  trade.grade === grade ? "border-accent bg-accent text-white" : "border-line text-muted"
                }`}
              >
                {grade}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-muted">
            <input
              type="checkbox"
              checked={trade.excluded}
              onChange={(event) => patch.mutate({ excluded: event.target.checked })}
            />
            Exclude from stats
          </label>
          <textarea
            aria-label="Notes"
            defaultValue={trade.notes ?? ""}
            onBlur={(event) => patch.mutate({ notes: event.target.value })}
            className="mt-2 min-h-20 w-full rounded-sm border border-line bg-[#0e1118] p-2 text-fg outline-none focus:border-accent"
          />
          {patch.error && <p className="mt-2 text-down">{String(patch.error)}</p>}
        </Panel>
      </div>
    </div>
  );
}

function Tile({
  label,
  children,
  testId,
  empty = false,
}: {
  label: string;
  children: ReactNode;
  testId?: string;
  empty?: boolean;
}) {
  return (
    <div className={`rounded-sm border bg-panel p-2 ${empty ? "border-line border-dashed" : "border-line"}`}>
      <div className="text-[10px] text-muted uppercase tracking-wider">{label}</div>
      <div
        className={`num mt-1 font-semibold text-[15px] ${empty ? "text-[#4b5263]" : ""}`}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  );
}
