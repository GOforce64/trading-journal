import {
  closedTrades,
  type MissedBreakdown,
  missedBreakdown,
  missedSummary,
  nyDate,
  type ScalpStatTrade,
  takenVsMissed,
} from "@tj/core";
import { useMemo } from "react";
import { type Book, filterTrades } from "../analytics/data.js";
import { rText, segmentClass, winRateText } from "../analytics/format.js";
import { type Kpi, KpiStrip } from "../analytics/KpiStrip.js";
import { MissedBars } from "../analytics/MissedBars.js";
import { Section } from "../analytics/Section.js";
import { booksOf, toFilter } from "../analytics/search.js";
import type { TradeView } from "../api.js";
import { useSetups, useTags } from "../review/data.js";
import type { TabProps } from "./OverviewTab.js";

const DIMENSIONS: readonly { id: MissedBreakdown; label: string }[] = [
  { id: "skip", label: "Skip reason" },
  { id: "setup", label: "Setup" },
  { id: "ticker", label: "Ticker" },
  { id: "open", label: "Minutes after open" },
  { id: "weekday", label: "Weekday" },
  { id: "grade", label: "Grade" },
];

const TAKEN_BOOKS: readonly Book[] = ["live", "paper"];

const tone = (value: number | null | undefined) =>
  value == null || value === 0 ? "text-muted" : value > 0 ? "text-up" : "text-down";
const rCell = (value: number | null) => (value == null ? "—" : rText(value));
const tookText = (took: number | null) => (took == null ? "—" : `${Math.round(took * 100)}%`);

/**
 * The Analytics Missed tab (missed-trades spec §6.6): what the skips would have made, why they were skipped, and each
 * setup's taken trades beside its missed ones. It reads every missed trade, whatever the Book filter, through the
 * other filters, by the entry's New York date.
 */
export function MissedTab({ allTrades, search, onSearch }: TabProps & { allTrades: readonly TradeView[] }) {
  const { data: tags = [] } = useTags();
  const { data: setups = [] } = useSetups();
  const skips = useMemo(
    () => new Map(tags.filter((tag) => tag.kind === "skip").map((tag) => [tag.id, tag.name])),
    [tags],
  );
  const setupNames = useMemo(() => new Map(setups.map((setup) => [setup.id, setup.name])), [setups]);
  const missed = useMemo(
    () =>
      allTrades.filter((trade) => {
        if (trade.book !== "missed") return false;
        if (search.ticker && trade.underlying !== search.ticker) return false;
        if (search.setup && trade.setupId !== search.setup) return false;
        if (trade.excluded && !search.excluded) return false;
        const date = nyDate(trade.openedAt);
        return (!search.from || date >= search.from) && (!search.to || date <= search.to);
      }),
    [allTrades, search.ticker, search.setup, search.excluded, search.from, search.to],
  );
  // The taken scalps the Book filter's Live and Paper keep: both when it keeps neither (spec §6.6).
  const taken = useMemo(() => {
    const kept = booksOf(search).filter((book) => book !== "missed");
    const books = kept.length > 0 ? kept : TAKEN_BOOKS;
    return closedTrades(
      filterTrades(allTrades, { ...toFilter(search), books }).filter(
        (trade): trade is TradeView & ScalpStatTrade => trade.strategy === "scalp",
      ),
    );
  }, [allTrades, search]);
  const by = search.mby ?? "skip";
  const summary = missedSummary(missed, skips);
  const rows = missedBreakdown(missed, by, { setups: setupNames, skips });
  const pairs = takenVsMissed(taken, missed, setupNames);
  const label = DIMENSIONS.find((dimension) => dimension.id === by)?.label ?? by;
  const took = taken.length + missed.length ? taken.length / (taken.length + missed.length) : null;

  if (missed.length === 0) return <p className="text-muted">No missed trades for these filters.</p>;

  const kpis: Kpi[] = [
    { id: "missed", label: "Missed trades", value: String(summary.trades) },
    {
      id: "opportunity",
      label: "Missed opportunity",
      value: <span className={tone(summary.totalR)}>{rText(summary.totalR)}</span>,
      sub: `had you taken all ${summary.rCount}`,
    },
    {
      id: "won",
      label: "Would have won",
      value: winRateText(summary.winRate),
      sub: `${summary.wins} of ${summary.rCount}`,
    },
    {
      id: "avg-r",
      label: "Avg R",
      value: <span className={tone(summary.avgR)}>{rCell(summary.avgR)}</span>,
      sub: "on the stock",
    },
    {
      id: "good-skips",
      label: "Good skips",
      value: String(summary.goodSkips),
      sub: summary.goodSkips ? `would have lost ${rText(summary.goodSkipsR)}` : undefined,
    },
    {
      id: "took",
      label: "Took",
      value: tookText(took),
      sub: `${taken.length} taken · ${missed.length} missed`,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip kpis={kpis} />
      {summary.rCount < summary.trades && (
        <p className="text-[11px] text-muted">
          R covers {summary.rCount} of {summary.trades} missed trades: the rest lack a stop or an exit.
        </p>
      )}
      <Section title="Break down by">
        <fieldset aria-label="Dimension" className="mb-2 flex flex-wrap gap-1 text-[11px]">
          {DIMENSIONS.map((dimension) => (
            <button
              key={dimension.id}
              type="button"
              aria-pressed={dimension.id === by}
              onClick={() => onSearch({ mby: dimension.id === "skip" ? undefined : dimension.id })}
              className={segmentClass(dimension.id === by)}
            >
              {dimension.label}
            </button>
          ))}
        </fieldset>
        <div className="grid items-start gap-3 lg:grid-cols-[3fr_2fr]">
          <table aria-label={`By ${label}`} className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-[9px] text-muted uppercase tracking-wider">
                <th className="py-1 text-left font-medium">{label}</th>
                {["n", "Would win %", "Total R", "Avg R", "Avg MFE"].map((header) => (
                  <th key={header} className="text-right font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-line border-t">
                  <td className="py-0.5">{row.label}</td>
                  <td className="num text-right text-muted">{row.trades}</td>
                  <td className="num text-right">{winRateText(row.winRate)}</td>
                  <td className={`num text-right ${tone(row.rCount ? row.totalR : null)}`}>
                    {row.rCount ? rText(row.totalR) : "—"}
                  </td>
                  <td className={`num text-right ${tone(row.avgR)}`}>{rCell(row.avgR)}</td>
                  <td className="num text-right text-muted">{rCell(row.avgMfe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <MissedBars rows={rows} />
        </div>
      </Section>
      <Section title="Taken and missed, by setup">
        <table aria-label="Taken and missed, by setup" className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-[9px] text-muted uppercase tracking-wider">
              <th />
              <th colSpan={3} className="text-center font-medium">
                Taken (option R)
              </th>
              <th colSpan={3} className="border-line border-l text-center font-medium">
                Missed (stock R)
              </th>
              <th className="border-line border-l" />
            </tr>
            <tr className="text-[9px] text-muted uppercase tracking-wider">
              <th className="py-1 text-left font-medium">Setup</th>
              <th className="text-right font-medium">n</th>
              <th className="text-right font-medium">Win %</th>
              <th className="text-right font-medium">Avg R</th>
              <th className="border-line border-l text-right font-medium">n</th>
              <th className="text-right font-medium">Would win %</th>
              <th className="text-right font-medium">Avg R</th>
              <th className="border-line border-l text-right font-medium">Took</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((row) => (
              <tr key={row.setupId ?? "none"} className="border-line border-t">
                <td className={`py-0.5 ${row.setupId == null ? "text-muted" : ""}`}>{row.label}</td>
                <td className="num text-right text-muted">{row.taken.trades}</td>
                <td className="num text-right">{row.taken.trades ? winRateText(row.taken.winRate) : "—"}</td>
                <td className={`num text-right ${tone(row.taken.avgR)}`}>{rCell(row.taken.avgR)}</td>
                <td className="num border-line border-l text-right text-muted">{row.missed.trades}</td>
                <td className="num text-right">{winRateText(row.missed.winRate)}</td>
                <td className={`num text-right ${tone(row.missed.avgR)}`}>{rCell(row.missed.avgR)}</td>
                <td className="num border-line border-l text-right">{tookText(row.took)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[10px] text-muted">Took = taken ÷ (taken + missed).</p>
      </Section>
    </div>
  );
}
