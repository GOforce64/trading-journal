import {
  addDays,
  closedTrades,
  isTradingDay,
  missedSummary,
  nyDate,
  type ScalpStatTrade,
  summarize,
} from "@tj/core";
import { useEffect, useState } from "react";
import { useAllTrades } from "../analytics/data.js";
import { rText } from "../analytics/format.js";
import { type Kpi, KpiStrip } from "../analytics/KpiStrip.js";
import type { TradeView } from "../api.js";
import { Chip, Panel } from "../components/ui.js";
import { TICKER, todayNy } from "../market.js";
import { useSetups, useTags } from "../review/data.js";
import { lastSession, useMissedTrades } from "./data.js";

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** The page's periods, by the entry's New York date (missed-trades spec §6.1). */
const PERIODS = [
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "365", label: "Last 365 days", days: 365 },
  { id: "all", label: "All time", days: null },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

/** The page's URL: its period, left out at the default, Last 30 days, so Back from a trade keeps it. */
export interface MissedSearch {
  period?: PeriodId;
}

export function parseMissedSearch(raw: Record<string, unknown>): MissedSearch {
  const found = PERIODS.find((each) => each.id === raw.period);
  return found && found.id !== "30" ? { period: found.id } : {};
}

const tone = (value: number | null | undefined) =>
  value == null || value === 0 ? "" : value > 0 ? "text-up" : "text-down";

/** What a missed trade still needs, in place of its R. */
const NEEDS: Record<string, string> = {
  no_stop: "needs stop",
  no_exit: "needs exit",
  wrong_side: "check stop",
  stop_at_entry: "check stop",
};

/** The Missed page (missed-trades spec §6.1): what the period's skips would have made, and the list of them. */
export function MissedPage({
  period: chosen,
  onPeriod,
  onOpenTrade,
  onNewMissed,
}: {
  /** The URL's period; without `onPeriod` the page keeps its own. */
  period?: PeriodId;
  onPeriod?: (period: PeriodId) => void;
  onOpenTrade?: (id: string) => void;
  onNewMissed?: (symbol: string, date: string) => void;
}) {
  const [own, setOwn] = useState<PeriodId>(chosen ?? "30");
  const period = onPeriod ? (chosen ?? "30") : own;
  const setPeriod = onPeriod ?? setOwn;
  const [adding, setAdding] = useState(false);
  const { data: missed, isLoading } = useMissedTrades();
  const { data: all } = useAllTrades();
  const { data: tags = [] } = useTags();
  const { data: setups = [] } = useSetups();
  const skips = new Map(tags.filter((tag) => tag.kind === "skip").map((tag) => [tag.id, tag.name]));
  const setupNames = new Map(setups.map((setup) => [setup.id, setup.name]));

  const days = PERIODS.find((each) => each.id === period)?.days ?? null;
  const from = days == null ? null : addDays(todayNy(), -(days - 1));
  const inPeriod = (at: number) => from == null || nyDate(at) >= from;
  const shown = (missed ?? [])
    .filter((trade) => inPeriod(trade.openedAt))
    .sort((a, b) => b.openedAt - a.openedAt);
  const counted = shown.filter((trade) => !trade.excluded);
  const summary = missedSummary(counted, skips);
  const taken = closedTrades(
    (all ?? []).filter(
      (trade): trade is TradeView & ScalpStatTrade =>
        trade.strategy === "scalp" &&
        trade.book !== "missed" &&
        !trade.excluded &&
        trade.closedAt != null &&
        inPeriod(trade.closedAt),
    ),
  );
  const takenR = summarize(taken).avgR;

  const kpis: Kpi[] = [
    {
      id: "opportunity",
      label: "Missed opportunity",
      value: <span className={tone(summary.totalR)}>{rText(summary.totalR)}</span>,
      sub: `the R of all ${summary.rCount}, had you taken them`,
    },
    {
      id: "won",
      label: "Would have won",
      value: `${summary.wins} of ${summary.rCount}`,
      sub: summary.winRate == null ? undefined : `${Math.round(summary.winRate * 100)}%`,
    },
    {
      id: "avg-r",
      label: "Avg R",
      value: <span className={tone(summary.avgR)}>{summary.avgR == null ? "—" : rText(summary.avgR)}</span>,
      sub: takenR == null ? undefined : `taken scalps: ${rText(takenR)}`,
    },
    {
      id: "good-skips",
      label: "Good skips",
      value: String(summary.goodSkips),
      sub: summary.goodSkips ? `would have lost ${rText(summary.goodSkipsR)}` : undefined,
    },
    {
      id: "reason",
      label: "Top reason",
      value: summary.topReason ? (skips.get(summary.topReason.tagId) ?? "—") : "—",
      sub: summary.topReason
        ? `${summary.topReason.trades} trade${summary.topReason.trades === 1 ? "" : "s"} · ${rText(summary.topReason.totalR)}`
        : undefined,
    },
  ];

  return (
    <div className="relative flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="font-semibold text-[16px]">Missed</h1>
        <span className="text-muted">Setups you saw and didn't take, scored in R on the stock</span>
        <select
          aria-label="Period"
          value={period}
          onChange={(event) => setPeriod(event.target.value as PeriodId)}
          className="ml-auto rounded-sm border border-line bg-panel px-1.5 py-0.5 text-fg"
        >
          {PERIODS.map((each) => (
            <option key={each.id} value={each.id}>
              {each.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setAdding((open) => !open)}
          className="rounded-sm border border-accent bg-accent px-2.5 py-1 text-white"
        >
          + Missed trade
        </button>
      </header>
      {adding && <NewMissedPopover onClose={() => setAdding(false)} onOpen={onNewMissed} />}
      <KpiStrip kpis={kpis} />
      <Panel title="Missed trades">
        {isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-muted">
            No missed trades in this period. + Missed trade marks one on a day's chart.
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="text-left text-[9px] text-muted uppercase tracking-wider">
                <th className="w-28 py-1 font-normal">Entry</th>
                <th className="w-16 font-normal">Symbol</th>
                <th className="w-14 font-normal">Dir</th>
                <th className="font-normal">Setup</th>
                <th className="font-normal">Skipped</th>
                <th className="font-normal">Notes</th>
                <th className="w-24 text-right font-normal">R</th>
                <th className="w-16 text-right font-normal">MFE</th>
                <th className="w-12 text-right font-normal">Grade</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((trade) => {
                const risk = trade.missedRisk;
                const reason = trade.tagIds.find((id) => skips.has(id));
                const long = trade.missed?.direction === "long";
                return (
                  <tr
                    key={trade.id}
                    tabIndex={0}
                    onClick={() => onOpenTrade?.(trade.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onOpenTrade?.(trade.id);
                    }}
                    className="cursor-pointer border-line border-t hover:bg-[#1c2130] focus:bg-[#1c2130] focus:outline-none"
                  >
                    <td className="num whitespace-nowrap py-1 text-muted">
                      {ET.format(new Date(trade.openedAt))}
                    </td>
                    <td className="text-fg">{trade.underlying}</td>
                    <td>
                      <span
                        className={`rounded-[2px] px-1.5 py-px text-[10px] ${
                          long ? "bg-[#26a69a22] text-up" : "bg-[#ef535022] text-down"
                        }`}
                      >
                        {long ? "Long" : "Short"}
                      </span>
                    </td>
                    <td className="truncate pr-2 text-muted">{setupNames.get(trade.setupId ?? "") ?? "—"}</td>
                    <td className="truncate pr-2">
                      {reason ? skips.get(reason) : <span className="text-muted">—</span>}
                    </td>
                    <td className="truncate pr-2 text-muted" title={trade.notes ?? undefined}>
                      {trade.notes ?? ""}
                    </td>
                    <td className="num text-right">
                      {risk?.r != null ? (
                        <span className={tone(risk.r)}>{rText(risk.r)}</span>
                      ) : risk?.problem ? (
                        <Chip tone="missed">{NEEDS[risk.problem]}</Chip>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {trade.excluded && (
                        <>
                          {" "}
                          <Chip tone="excluded">EXCLUDED</Chip>
                        </>
                      )}
                    </td>
                    <td className="num text-right text-muted">{risk?.mfe == null ? "—" : rText(risk.mfe)}</td>
                    <td className="num text-right text-muted">{trade.grade ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

/** + Missed trade (spec §6.1): a ticker and a session, then that day's chart. */
function NewMissedPopover({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen?: (symbol: string, date: string) => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [date, setDate] = useState(() => lastSession(Date.now()));
  const ticker = symbol.trim().toUpperCase();
  const trading = /^\d{4}-\d{2}-\d{2}$/.test(date) && isTradingDay(date);
  const ready = TICKER.test(ticker) && trading;
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-label="New missed trade"
      className="absolute top-9 right-0 z-30 w-64 rounded-sm border border-accent bg-panel p-3 shadow-xl"
    >
      <div className="mb-2 font-semibold text-fg">New missed trade</div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onOpen?.(ticker, date);
        }}
        className="flex flex-col gap-2"
      >
        <label className="flex items-center gap-2">
          <span className="w-12 text-[10px] text-muted uppercase tracking-wider">Ticker</span>
          <input
            aria-label="Ticker"
            // biome-ignore lint/a11y/noAutofocus: the popover opens to take a ticker
            autoFocus
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            className="num w-24 rounded-sm border border-line bg-[#0e1118] px-1.5 py-0.5 text-fg outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-12 text-[10px] text-muted uppercase tracking-wider">Date</span>
          <input
            aria-label="Date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="num rounded-sm border border-line bg-[#0e1118] px-1.5 py-0.5 text-fg outline-none focus:border-accent"
          />
        </label>
        {!trading && date !== "" && <p className="text-[11px] text-down">Not a trading day</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-line px-2 py-0.5 text-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready}
            className="rounded-sm border border-accent bg-accent px-2 py-0.5 text-white disabled:opacity-40"
          >
            Open chart →
          </button>
        </div>
        <p className="text-[10px] text-muted">
          Then click the entry on the chart. Long or Short follows from the side you put the stop on.
        </p>
      </form>
    </div>
  );
}
