import {
  type BreakdownContext,
  bucketStats,
  closedTrades,
  type MissedRow,
  missedRows,
  mistakeCost,
  scalpBreakdown,
  scalpSummary,
  withMissed,
  withMissedGroups,
} from "@tj/core";
import { useMemo } from "react";
import { BreakdownPanel } from "../analytics/Breakdown.js";
import { useAllTrades } from "../analytics/data.js";
import { rememberEdges, resolveEdges } from "../analytics/edges.js";
import { profitFactorText, rText, segmentClass, winRateText } from "../analytics/format.js";
import { KpiStrip } from "../analytics/KpiStrip.js";
import { MistakeCost } from "../analytics/MistakeCost.js";
import { MetricBars } from "../analytics/ScalpCharts.js";
import { Section } from "../analytics/Section.js";
import type { EdgeControl } from "../analytics/SplitGrid.js";
import { coverageText, holdText, METRICS, type Metric, returnText } from "../analytics/scalpText.js";
import { Money } from "../components/ui.js";
import { type Setup, type Tag, useSetups, useTags } from "../review/data.js";
import { useBackfillPrices } from "../review/prices.js";
import type { TabProps } from "./OverviewTab.js";

const tagNames = (tags: readonly Tag[] | undefined, kind: "mistake" | "emotion") =>
  new Map((tags ?? []).filter((tag) => tag.kind === kind).map((tag) => [tag.id, tag.name]));

const NO_SETUPS: readonly Setup[] = [];

const openTitle = (label: string) => (label === "before open" ? label : `${label} min after the open`);
const holdTitle = (label: string) => {
  if (label === "unknown") return "unknown hold";
  return `held ${label.endsWith("min") ? label : `${label} min`}`;
};

/** Which scalps work: by time of day, hold, setup and the rest (scalp-analytics spec §6). */
export function ScalpsTab({ trades, search, onSearch }: TabProps) {
  const scalps = useMemo(() => closedTrades(trades.filter((trade) => trade.strategy === "scalp")), [trades]);
  const { data: setups = NO_SETUPS } = useSetups();
  const { data: tags, isError: tagsFailed } = useTags();
  // Every scalp, not just the filtered ones: the backfill runs once a visit (spec §8).
  const fill = useBackfillPrices(useAllTrades().data);
  const by = search.by ?? "setup";
  const costEdges = resolveEdges("cost", search.costEdges);
  const contractEdges = resolveEdges("contracts", search.contractEdges);
  // Worked out again only when the scalps, the names or the edges change, not on every render.
  const costKey = costEdges.join(",");
  const contractKey = contractEdges.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the edges are keyed by their text, a fresh array each render
  const context = useMemo<BreakdownContext>(
    () => ({
      setups: new Map(setups.map((setup) => [setup.id, setup.name])),
      emotions: tagNames(tags, "emotion"),
      costEdges,
      contractEdges,
    }),
    [setups, tags, costKey, contractKey],
  );
  const summary = useMemo(() => scalpSummary(scalps), [scalps]);
  // With Missed in the books, missed trades join N, win % and Avg R, never the dollars (missed-trades spec §6.8).
  const missed = useMemo(() => trades.filter((trade) => trade.book === "missed"), [trades]);
  const mixed = useMemo(() => (missed.length > 0 ? withMissed(scalps, missed) : null), [scalps, missed]);
  const join = <R extends Parameters<typeof withMissedGroups>[0][number]>(
    rows: readonly R[],
    extra: MissedRow[] | null,
  ) => (missed.length > 0 && extra ? withMissedGroups(rows, extra) : rows);
  // biome-ignore lint/correctness/useExhaustiveDependencies: join reads the missed trades, listed here
  const openRows = useMemo(
    () => join(bucketStats(scalps, "open"), missedRows(missed, "open", context)),
    [scalps, missed, context],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: join reads the missed trades, listed here
  const holdRows = useMemo(
    () => join(bucketStats(scalps, "hold"), missedRows(missed, "hold", context)),
    [scalps, missed, context],
  );
  const missedByDimension = useMemo(() => missedRows(missed, by, context), [missed, by, context]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: join reads the missed trades, listed here
  const breakdown = useMemo(
    () => join(scalpBreakdown(scalps, by, context), missedByDimension),
    [scalps, by, context, missedByDimension, missed],
  );
  const contractNote =
    missed.length > 0 && missedByDimension === null
      ? "Missed trades have no contract, so they aren't in this breakdown."
      : undefined;
  const counted = mixed ?? summary;
  const missedWithR = mixed ? mixed.rCount - summary.rCount : 0;
  const mistakes = useMemo(
    () => (tags ? mistakeCost(scalps, tagNames(tags, "mistake")) : null),
    [scalps, tags],
  );
  const none = summary.trades === 0;
  const empty = none && missed.length === 0;
  // Missed alone has no dollars to draw, so its bars default to R and Net is off (missed-trades spec §6.8).
  const dollarless = none && missed.length > 0;
  const metric: Metric = search.metric ?? (dollarless ? "r" : "net");

  let edges: EdgeControl | undefined;
  if (by === "cost") {
    edges = {
      kind: "usd",
      edges: costEdges,
      onChange: (next) => {
        rememberEdges("cost", next);
        onSearch({ costEdges: next ? next.join(",") : undefined });
      },
    };
  } else if (by === "contracts") {
    edges = {
      kind: "contracts",
      edges: contractEdges,
      onChange: (next) => {
        rememberEdges("contracts", next);
        onSearch({ contractEdges: next ? next.join(",") : undefined });
      },
    };
  }

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        kpis={[
          { id: "net", label: "Net P&L", value: none ? "—" : <Money value={summary.net} /> },
          { id: "win-rate", label: "Win rate", value: winRateText(counted.winRate) },
          {
            id: "avg-r",
            label: "Avg R",
            value: counted.avgR == null ? "—" : rText(counted.avgR),
            sub:
              missedWithR > 0
                ? `includes ${missedWithR} missed (stock R)`
                : none
                  ? undefined
                  : `over ${summary.rCount} of ${summary.trades}`,
          },
          {
            id: "avg-return",
            label: "Avg return",
            value: returnText(summary.avgReturn),
            sub: "on premium paid",
          },
          { id: "profit-factor", label: "Profit factor", value: profitFactorText(summary.profitFactor) },
          {
            id: "expectancy",
            label: "Expectancy",
            value: summary.expectancy == null ? "—" : <Money value={summary.expectancy} />,
          },
          {
            id: "avg-hold",
            label: "Avg hold",
            value: holdText(summary.avgHoldMinutes),
            sub:
              summary.medianHoldMinutes == null ? undefined : `median ${holdText(summary.medianHoldMinutes)}`,
          },
          { id: "scalps", label: "Scalps", value: counted.trades },
        ]}
      />
      {empty ? (
        <p className="text-muted">No closed scalps in this range.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p data-testid="r-coverage" className="text-[10px] text-muted">
              {coverageText(
                summary.coverage,
                fill,
                missed.length > 0 ? { total: missed.length, withR: missedWithR } : null,
              )}
            </p>
            <fieldset aria-label="Bars" className="flex items-center gap-1 text-[11px]">
              <span className="mr-1 text-[9px] text-muted uppercase tracking-wider">Bars</span>
              {METRICS.map((each) => (
                <button
                  key={each.id}
                  type="button"
                  aria-pressed={each.id === metric}
                  disabled={dollarless && each.id === "net"}
                  title={dollarless && each.id === "net" ? "Missed trades have no dollars" : undefined}
                  onClick={() => onSearch({ metric: each.id === "net" ? undefined : each.id })}
                  className={segmentClass(each.id === metric)}
                >
                  {each.label}
                </button>
              ))}
            </fieldset>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Section title="Minutes after the open">
              <MetricBars rows={openRows} metric={metric} title={openTitle} />
            </Section>
            <Section title="Hold time">
              <MetricBars rows={holdRows} metric={metric} title={holdTitle} />
            </Section>
          </div>
          <BreakdownPanel
            by={by}
            onBy={(next) => onSearch({ by: next === "setup" ? undefined : next })}
            rows={breakdown}
            metric={metric}
            edges={edges}
            note={contractNote}
          />
          {mistakes ? (
            <MistakeCost rows={mistakes} />
          ) : (
            <Section title="Mistake cost">
              <p className="text-muted">{tagsFailed ? "Couldn't load the tags." : "Loading…"}</p>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
