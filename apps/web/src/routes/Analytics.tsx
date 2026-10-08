import { useMemo, useState } from "react";
import { filterTrades, useAllTrades } from "../analytics/data.js";
import { segmentClass } from "../analytics/format.js";
import {
  type AnalyticsSearch,
  activePreset,
  DATE_PRESETS,
  presetRange,
  toFilter,
} from "../analytics/search.js";
import { TabButton } from "../components/ui.js";
import { todayNy } from "../market.js";
import { type Setup, useSetups } from "../review/data.js";
import { FliesTab } from "./FliesTab.js";
import { MissedTab } from "./MissedTab.js";
import { OverviewTab } from "./OverviewTab.js";
import { ScalpsTab } from "./ScalpsTab.js";

export interface AnalyticsProps {
  search: AnalyticsSearch;
  onSearch: (patch: Partial<AnalyticsSearch>) => void;
  onOpenTrade?: (id: string) => void;
}

const INPUT =
  "num rounded-sm border border-line bg-[#0e1118] px-1.5 py-0.5 text-[11px] text-fg outline-none focus:border-accent";

/** Aggregated statistics over the filtered trades (spec §7). */
export function Analytics({ search, onSearch, onOpenTrade }: AnalyticsProps) {
  const { data, isLoading, error } = useAllTrades();
  const { data: setups } = useSetups();
  const tickers = useMemo(() => [...new Set((data ?? []).map((trade) => trade.underlying))].sort(), [data]);
  // A ticker or setup the journal doesn't have (an old or hand-edited link) counts as All, which is what the
  // dropdown shows. A setup is only judged once the setups have loaded.
  const view = useMemo(() => {
    let next = search;
    if (next.ticker && !tickers.includes(next.ticker)) next = { ...next, ticker: undefined };
    if (next.setup && setups && !setups.some((setup) => setup.id === next.setup))
      next = { ...next, setup: undefined };
    return next;
  }, [search, tickers, setups]);
  const trades = useMemo(() => filterTrades(data ?? [], toFilter(view)), [data, view]);

  if (isLoading) return <p className="text-muted">Loading…</p>;
  if (error) return <p className="text-down">Could not load trades: {String(error)}</p>;

  return (
    <div className="flex flex-col gap-3">
      <FilterRow search={view} onSearch={onSearch} tickers={tickers} setups={setups ?? []} />
      <nav aria-label="Analytics tabs" className="flex gap-4 border-line border-b text-[12px]">
        <TabButton active={search.tab === undefined} onClick={() => onSearch({ tab: undefined })}>
          Overview
        </TabButton>
        <TabButton active={search.tab === "scalps"} onClick={() => onSearch({ tab: "scalps" })}>
          Scalps
        </TabButton>
        <TabButton active={search.tab === "flies"} onClick={() => onSearch({ tab: "flies" })}>
          Iron flies
        </TabButton>
        <TabButton active={search.tab === "missed"} onClick={() => onSearch({ tab: "missed" })}>
          Missed
        </TabButton>
      </nav>
      {search.tab === "scalps" && (
        <ScalpsTab trades={trades} search={search} onSearch={onSearch} onOpenTrade={onOpenTrade} />
      )}
      {search.tab === "flies" && (
        <FliesTab trades={trades} search={search} onSearch={onSearch} onOpenTrade={onOpenTrade} />
      )}
      {search.tab === "missed" && (
        <MissedTab
          trades={trades}
          allTrades={data ?? []}
          search={view}
          onSearch={onSearch}
          onOpenTrade={onOpenTrade}
        />
      )}
      {search.tab === undefined && (
        <OverviewTab trades={trades} search={search} onSearch={onSearch} onOpenTrade={onOpenTrade} />
      )}
    </div>
  );
}

function FilterRow({
  search,
  onSearch,
  tickers,
  setups,
}: {
  search: AnalyticsSearch;
  onSearch: AnalyticsProps["onSearch"];
  tickers: readonly string[];
  setups: readonly Setup[];
}) {
  const today = todayNy();
  const preset = activePreset(search, today);
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = customOpen || preset === "custom";
  const books = search.books ? [search.books] : ["live", "paper"];
  // Archived setups stay out of the list unless the link names one. A linked setup the list doesn't have yet (the
  // setups still loading, or failed) still filters the trades, so it keeps an option rather than showing All.
  const setupOptions = setups
    .filter((setup) => !setup.archived || setup.id === search.setup)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (search.setup && !setupOptions.some((setup) => setup.id === search.setup)) {
    setupOptions.unshift({ id: search.setup, name: "this setup" } as Setup);
  }

  // One book must stay on: switching off the other leaves just this one, and the last one can't be switched off.
  const toggleBook = (book: "live" | "paper") => {
    if (books.length === 1) {
      if (books[0] !== book) onSearch({ books: undefined });
      return;
    }
    onSearch({ books: book === "live" ? "paper" : "live" });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <label className="flex items-center gap-1 text-muted uppercase tracking-wider">
        Dates
        <select
          aria-label="Dates"
          value={showCustom ? "custom" : preset}
          onChange={(event) => {
            const chosen = DATE_PRESETS.find((option) => option.id === event.target.value);
            setCustomOpen(!chosen);
            if (chosen) {
              const range = presetRange(chosen.id, today);
              onSearch({ from: range.from, to: range.to });
            }
          }}
          className={INPUT}
        >
          {DATE_PRESETS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      {showCustom && (
        <>
          <input
            type="date"
            aria-label="From"
            value={search.from ?? ""}
            onChange={(event) => onSearch({ from: event.target.value || undefined })}
            className={INPUT}
          />
          <input
            type="date"
            aria-label="To"
            value={search.to ?? ""}
            onChange={(event) => onSearch({ to: event.target.value || undefined })}
            className={INPUT}
          />
        </>
      )}
      <span className="ml-2 text-muted uppercase tracking-wider">Book</span>
      {(["live", "paper"] as const).map((book) => (
        <button
          key={book}
          type="button"
          aria-pressed={books.includes(book)}
          onClick={() => toggleBook(book)}
          className={segmentClass(books.includes(book))}
        >
          {book === "live" ? "Live" : "Paper"}
        </button>
      ))}
      <label className="ml-2 flex items-center gap-1 text-muted uppercase tracking-wider">
        Ticker
        <select
          aria-label="Ticker"
          value={search.ticker ?? ""}
          onChange={(event) => onSearch({ ticker: event.target.value || undefined })}
          className={INPUT}
        >
          <option value="">All</option>
          {tickers.map((ticker) => (
            <option key={ticker} value={ticker}>
              {ticker}
            </option>
          ))}
        </select>
      </label>
      <label className="ml-2 flex items-center gap-1 text-muted uppercase tracking-wider">
        Setup
        <select
          aria-label="Setup"
          value={search.setup ?? ""}
          onChange={(event) => onSearch({ setup: event.target.value || undefined })}
          className={INPUT}
        >
          <option value="">All</option>
          {setupOptions.map((setup) => (
            <option key={setup.id} value={setup.id}>
              {setup.name}
            </option>
          ))}
        </select>
      </label>
      <label className="ml-2 flex items-center gap-1 text-muted">
        <input
          type="checkbox"
          checked={search.excluded === true}
          onChange={(event) => onSearch({ excluded: event.target.checked ? true : undefined })}
        />
        Include excluded
      </label>
    </div>
  );
}
