import { closedTrades, creditSplit, keptHistogram, keptStats, wingsSplit, wingWidthSplit } from "@tj/core";
import { KeptHistogram } from "../analytics/Charts.js";
import { rememberEdges, resolveEdges } from "../analytics/edges.js";
import { shareText } from "../analytics/format.js";
import { KpiStrip } from "../analytics/KpiStrip.js";
import { Section } from "../analytics/Section.js";
import { SplitGrid } from "../analytics/SplitGrid.js";
import type { TabProps } from "./OverviewTab.js";

const wholeDollars = (value: number | null) =>
  value == null ? "—" : `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** How much credit the flies keep, and the splits only flies have (spec §7.3). */
export function FliesTab({ trades, search, onSearch }: TabProps) {
  const flies = closedTrades(trades.filter((trade) => trade.strategy === "iron_fly"));
  const kept = keptStats(flies);
  const creditEdges = resolveEdges("usd", search.creditEdges);
  const tickers = new Map(flies.map((trade) => [trade.id, trade.underlying]));
  const withMoves = flies.filter(
    (trade) => trade.ironFly?.impliedMovePct != null && trade.ironFly.actualMovePct != null,
  ).length;

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        kpis={[
          { id: "avg-credit", label: "Avg credit", value: wholeDollars(kept.avgCredit), sub: "per trade" },
          {
            id: "avg-max-profit",
            label: "Avg max profit",
            value: wholeDollars(kept.avgMaxProfit),
            sub: "credit after fees",
          },
          {
            id: "winners-keep",
            label: "Winners keep",
            value: <span className="text-up">{shareText(kept.winnersKeep?.mean ?? null)}</span>,
            sub: `of max profit · median ${shareText(kept.winnersKeep?.median ?? null)}`,
          },
          {
            id: "losers-lose",
            label: "Losers lose",
            value: <span className="text-down">{shareText(kept.losersLose?.mean ?? null)}</span>,
            sub: `of max profit · median ${shareText(kept.losersLose?.median ?? null)}`,
          },
          {
            id: "kept-overall",
            label: "Kept overall",
            value: shareText(kept.keptOverall),
            sub: "of all max profit on offer",
          },
        ]}
      />
      {kept.skipped > 0 && (
        <p className="text-[10px] text-muted">
          {kept.skipped} {kept.skipped === 1 ? "fly is" : "flies are"} left out: fees at or above the credit,
          or no credit recorded.
        </p>
      )}
      <Section title="% of max profit kept, per trade">
        {flies.length === 0 ? (
          <p className="text-muted">No closed trades in this range.</p>
        ) : (
          <KeptHistogram bins={keptHistogram(flies)} tickers={tickers} />
        )}
      </Section>
      <SplitGrid
        panels={[
          {
            title: "Credit",
            rows: creditSplit(flies, creditEdges),
            edges: {
              kind: "usd",
              edges: creditEdges,
              onChange: (edges) => {
                rememberEdges("usd", edges);
                onSearch({ creditEdges: edges ? edges.join(",") : undefined });
              },
            },
          },
          { title: "Wings", rows: wingsSplit(flies) },
          { title: "Wider wing width", rows: wingWidthSplit(flies) },
        ]}
      />
      <Section title="Implied vs actual move · IV crush · P&L by move ratio">
        <p className="rounded-sm border border-line border-dashed p-3 text-center text-[11px] text-muted">
          These charts fill in once each trade has its implied and actual move. {withMoves} of {flies.length}{" "}
          closed flies have them.
        </p>
      </Section>
    </div>
  );
}
