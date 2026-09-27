import {
  type ClosedTrade,
  closedTrades,
  contractsSplit,
  dteSplit,
  equityCurve,
  holdSplit,
  largestLosses,
  monthlyPnl,
  monthSplit,
  pctKept,
  rollingExpectancy,
  round2,
  type Summary,
  summarize,
  tickerSplit,
  weekdaySplit,
} from "@tj/core";
import { MonthBars, RollingLine } from "../analytics/Charts.js";
import { EquityCurve } from "../analytics/EquityCurve.js";
import { rememberEdges, resolveEdges } from "../analytics/edges.js";
import { profitFactorText, shareText, winRateText } from "../analytics/format.js";
import { KpiStrip } from "../analytics/KpiStrip.js";
import { Section } from "../analytics/Section.js";
import { SplitGrid } from "../analytics/SplitGrid.js";
import type { AnalyticsSearch } from "../analytics/search.js";
import type { TradeView } from "../api.js";
import { Money } from "../components/ui.js";

const ET_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});

export interface TabProps {
  trades: readonly TradeView[];
  search: AnalyticsSearch;
  onSearch: (patch: Partial<AnalyticsSearch>) => void;
  onOpenTrade?: (id: string) => void;
}

/** Where the money goes, how it's trending, and what works (spec §7.2). */
export function OverviewTab({ trades, search, onSearch, onOpenTrade }: TabProps) {
  const closed = closedTrades(trades);
  const summary = summarize(closed);
  const none = summary.trades === 0;
  const rolling = rollingExpectancy(closed);
  const contractEdges = resolveEdges("contracts", search.contractEdges);

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        kpis={[
          { id: "net", label: "Net P&L", value: none ? "—" : <Money value={summary.net} /> },
          { id: "win-rate", label: "Win rate", value: winRateText(summary.winRate) },
          { id: "profit-factor", label: "Profit factor", value: profitFactorText(summary.profitFactor) },
          {
            id: "expectancy",
            label: "Expectancy",
            value: summary.expectancy == null ? "—" : <Money value={summary.expectancy} />,
          },
          {
            id: "avg-win-loss",
            label: "Avg win / loss",
            value: (
              <>
                <Money value={summary.avgWin} /> <span className="text-muted">/</span>{" "}
                <Money value={summary.avgLoss} />
              </>
            ),
          },
          { id: "trades", label: "Trades", value: summary.trades },
          {
            id: "max-drawdown",
            label: "Max drawdown",
            value: none ? "—" : <Money value={summary.maxDrawdown} />,
          },
        ]}
      />
      <Section title="Equity">
        <EquityCurve points={equityCurve(closed)} />
      </Section>
      <div className="grid gap-3 lg:grid-cols-2">
        <MoneyPanel summary={summary} closed={closed} onOpenTrade={onOpenTrade} />
        <Section title="Trend">
          <MonthBars months={monthlyPnl(closed)} />
          <div className="mt-2 text-[9px] text-muted uppercase tracking-wider">
            Expectancy, rolling 10 trades
          </div>
          {rolling.length > 0 ? (
            <RollingLine points={rolling} />
          ) : (
            <p className="text-muted">Needs 10 trades.</p>
          )}
        </Section>
      </div>
      <SplitGrid
        panels={[
          { title: "Weekday opened", rows: weekdaySplit(closed) },
          { title: "Days to expiry", rows: dteSplit(closed) },
          {
            title: "Contracts",
            rows: contractsSplit(closed, contractEdges),
            edges: {
              kind: "contracts",
              edges: contractEdges,
              onChange: (edges) => {
                rememberEdges("contracts", edges);
                onSearch({ contractEdges: edges ? edges.join(",") : undefined });
              },
            },
          },
          { title: "Hold time", rows: holdSplit(closed) },
          { title: "Month", rows: monthSplit(closed) },
          { title: "Ticker", rows: tickerSplit(closed) },
        ]}
      />
    </div>
  );
}

function MoneyRow({
  label,
  value,
  scale,
  count,
}: {
  label: string;
  value: number;
  scale: number;
  count?: number;
}) {
  return (
    <>
      <span className="text-muted">{label}</span>
      <span className="flex">
        <span
          className={`h-[7px] rounded-[1px] ${value >= 0 ? "bg-up" : "bg-down"}`}
          style={{ width: `${(Math.abs(value) / scale) * 100}%` }}
        />
      </span>
      <span className="text-right">
        <Money value={value} />
        {count != null && <span className="ml-1 text-muted">{count} tr</span>}
      </span>
    </>
  );
}

function MoneyPanel({
  summary,
  closed,
  onOpenTrade,
}: {
  summary: Summary;
  closed: readonly ClosedTrade[];
  onOpenTrade?: (id: string) => void;
}) {
  const losers = largestLosses(closed);
  const lost = round2(losers.reduce((sum, trade) => sum + trade.netPnl, 0));
  const scale = Math.max(
    1,
    Math.abs(summary.beforeFees),
    summary.fees,
    Math.abs(summary.net),
    summary.grossWins,
    Math.abs(summary.grossLosses),
  );
  return (
    <Section title="Where the money goes">
      <div className="num grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 text-[11px]">
        <MoneyRow label="Before fees" value={summary.beforeFees} scale={scale} />
        <MoneyRow label="Fees" value={-summary.fees} scale={scale} />
        <MoneyRow label="Net" value={summary.net} scale={scale} />
        <MoneyRow label="Won" value={summary.grossWins} scale={scale} count={summary.wins} />
        <MoneyRow label="Lost" value={summary.grossLosses} scale={scale} count={summary.losses} />
      </div>
      {losers.length > 0 && (
        <>
          <div className="mt-3 mb-1 text-[9px] text-muted uppercase tracking-wider">Largest losses</div>
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              {losers.map((trade) => {
                const kept = pctKept(trade);
                return (
                  <tr key={trade.id} className="border-line border-t">
                    <td className="num py-0.5 text-muted">{ET_DAY.format(new Date(trade.closedAt))}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => onOpenTrade?.(trade.id)}
                        className="text-fg hover:text-accent"
                      >
                        {trade.underlying}
                      </button>
                    </td>
                    <td className="text-right">
                      <Money value={trade.netPnl} />
                    </td>
                    <td className="num text-right text-muted">
                      {kept == null ? "" : `kept ${shareText(kept)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {summary.net < 0 && (
            <p className="mt-1 text-[10px] text-muted">
              The {losers.length} largest losses are {(lost / summary.net).toFixed(1)}× the whole net loss.
            </p>
          )}
        </>
      )}
    </Section>
  );
}
