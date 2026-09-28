import {
  type ClosedTrade,
  closedTrades,
  closeEstimate,
  dailyPnl,
  equityCurve,
  type OptionQuote,
  summarize,
} from "@tj/core";
import { useState } from "react";
import { filterTrades, useAllTrades } from "../analytics/data.js";
import { shiftMonth } from "../analytics/dates.js";
import { EquityCurve } from "../analytics/EquityCurve.js";
import { profitFactorText, segmentClass, winRateText } from "../analytics/format.js";
import { KpiStrip } from "../analytics/KpiStrip.js";
import { PnlCalendar } from "../analytics/PnlCalendar.js";
import { Section } from "../analytics/Section.js";
import {
  calendarMonth,
  type DashboardSearch,
  type Period,
  periodLabel,
  periodRange,
  stepPeriod,
} from "../analytics/search.js";
import { EstimatedPnl } from "../components/Estimate.js";
import { Money } from "../components/ui.js";
import { isOpen, openContracts, todayNy, useOptionQuotes } from "../market.js";

const PERIODS: { id: Period; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "all", label: "All" },
];
const BOTH_BOOKS = ["live", "paper"] as const;
const NO_QUOTES = new Map<string, OptionQuote>();
const ET_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});
const MONTH_TITLE = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export interface DashboardProps {
  search: DashboardSearch;
  onSearch: (next: DashboardSearch) => void;
  onOpenTrade?: (id: string) => void;
}

/** The current period at a glance (spec §6). Excluded trades never count here. */
export function Dashboard({ search, onSearch, onOpenTrade }: DashboardProps) {
  const today = todayNy();
  const period: Period = search.period ?? "month";
  const at = search.at ?? today;
  const { data, isLoading, error } = useAllTrades();
  const counted = filterTrades(data ?? [], { books: BOTH_BOOKS, includeExcluded: false });
  const inPeriod = closedTrades(
    filterTrades(counted, { books: BOTH_BOOKS, includeExcluded: false, ...periodRange(period, at) }),
  );
  const summary = summarize(inPeriod);
  const days = dailyPnl(closedTrades(counted));
  const open = counted.filter(isOpen);
  const { data: optionQuotes } = useOptionQuotes(open.flatMap((trade) => openContracts(trade, today)));

  // The calendar steps on its own, and starts over whenever the period changes.
  const key = `${period}|${at}`;
  const [calendar, setCalendar] = useState({ key, month: calendarMonth(period, at, today) });
  const month = calendar.key === key ? calendar.month : calendarMonth(period, at, today);
  const [selected, setSelected] = useState<string | null>(null);

  // Month and today are defaults, so they stay out of the URL.
  const go = (next: { period?: Period; at?: string }) => {
    const nextPeriod = next.period ?? period;
    const nextAt = next.at ?? at;
    onSearch({
      ...(nextPeriod === "month" ? {} : { period: nextPeriod }),
      ...(nextAt === today ? {} : { at: nextAt }),
    });
  };

  if (isLoading) return <p className="text-muted">Loading…</p>;
  if (error) return <p className="text-down">Could not load trades: {String(error)}</p>;
  const none = summary.trades === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 text-[11px]">
        {PERIODS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={period === option.id}
            onClick={() => go({ period: option.id })}
            className={segmentClass(period === option.id)}
          >
            {option.label}
          </button>
        ))}
        {period !== "all" && (
          <>
            <button
              type="button"
              aria-label="Previous period"
              onClick={() => go({ at: stepPeriod(period, at, -1) })}
              className="ml-3 px-1 text-muted hover:text-fg"
            >
              ‹
            </button>
            <span className="num text-fg">{periodLabel(period, at)}</span>
            <button
              type="button"
              aria-label="Next period"
              onClick={() => go({ at: stepPeriod(period, at, 1) })}
              className="px-1 text-muted hover:text-fg"
            >
              ›
            </button>
          </>
        )}
      </div>

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
          { id: "trades", label: "Trades", value: summary.trades },
          {
            id: "max-drawdown",
            label: "Max drawdown",
            value: none ? "—" : <Money value={summary.maxDrawdown} />,
          },
        ]}
      />

      <Section title={`Equity · ${periodLabel(period, at)}`}>
        <EquityCurve points={equityCurve(inPeriod)} />
      </Section>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <Section
          title={`Calendar · ${MONTH_TITLE.format(new Date(`${month}-01T00:00:00Z`))}`}
          right={
            <span className="flex gap-2">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setCalendar({ key, month: shiftMonth(month, -1) })}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setCalendar({ key, month: shiftMonth(month, 1) })}
              >
                ›
              </button>
            </span>
          }
        >
          <PnlCalendar
            month={month}
            days={days}
            selected={selected}
            onSelect={(date) => setSelected((current) => (current === date ? null : date))}
          />
          {selected && (
            <DayTrades date={selected} trades={days.get(selected)?.trades ?? []} onOpenTrade={onOpenTrade} />
          )}
        </Section>

        <div className="flex flex-col gap-3">
          <Section title="Open">
            {open.length === 0 ? (
              <p className="text-muted">No open trades.</p>
            ) : (
              <ul className="flex flex-col">
                {open.map((trade) => (
                  <li key={trade.id} className="flex items-center justify-between border-line border-t py-1">
                    <button
                      type="button"
                      onClick={() => onOpenTrade?.(trade.id)}
                      className="text-fg hover:text-accent"
                    >
                      {trade.underlying}
                    </button>
                    <span className="text-muted">opened {ET_DAY.format(new Date(trade.openedAt))}</span>
                    <EstimatedPnl
                      estimate={closeEstimate(trade, optionQuotes?.quotes ?? NO_QUOTES, today)}
                      explain={optionQuotes?.available === true}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Recent">
            {none ? (
              <p className="text-muted">No closed trades in this range.</p>
            ) : (
              <TradeList trades={inPeriod.slice(-5).reverse()} onOpenTrade={onOpenTrade} />
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function TradeList({
  trades,
  label,
  onOpenTrade,
}: {
  trades: readonly ClosedTrade[];
  label?: string;
  onOpenTrade?: (id: string) => void;
}) {
  return (
    <ul aria-label={label} className="flex flex-col">
      {trades.map((trade) => (
        <li key={trade.id} className="flex items-center justify-between border-line border-t py-1">
          <span className="num text-muted">{ET_DAY.format(new Date(trade.closedAt))}</span>
          <button type="button" onClick={() => onOpenTrade?.(trade.id)} className="text-fg hover:text-accent">
            {trade.underlying}
          </button>
          <Money value={trade.netPnl} />
        </li>
      ))}
    </ul>
  );
}

function DayTrades({
  date,
  trades,
  onOpenTrade,
}: {
  date: string;
  trades: readonly ClosedTrade[];
  onOpenTrade?: (id: string) => void;
}) {
  return (
    <div className="mt-2">
      <TradeList trades={trades} label={`Trades closed ${date}`} onOpenTrade={onOpenTrade} />
    </div>
  );
}
