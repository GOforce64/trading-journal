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
import { todayNy } from "../market.js";
import { FliesTab } from "./FliesTab.js";
import { OverviewTab } from "./OverviewTab.js";

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
  const tickers = useMemo(() => [...new Set((data ?? []).map((trade) => trade.underlying))].sort(), [data]);
  // A ticker the journal doesn't have (an old or hand-edited link) counts as All, which is what the dropdown shows.
  const view = useMemo(
    () => (search.ticker && !tickers.includes(search.ticker) ? { ...search, ticker: undefined } : search),
    [search, tickers],
  );
  const trades = useMemo(() => filterTrades(data ?? [], toFilter(view)), [data, view]);

  if (isLoading) return <p className="text-muted">Loading…</p>;
  if (error) return <p className="text-down">Could not load trades: {String(error)}</p>;

  return (
    <div className="flex flex-col gap-3">
      <FilterRow search={view} onSearch={onSearch} tickers={tickers} />
      <nav aria-label="Analytics tabs" className="flex gap-4 border-line border-b text-[12px]">
        <TabButton active={search.tab !== "flies"} onClick={() => onSearch({ tab: undefined })}>
          Overview
        </TabButton>
        <TabButton active={search.tab === "flies"} onClick={() => onSearch({ tab: "flies" })}>
          Iron flies
        </TabButton>
      </nav>
      {search.tab === "flies" ? (
        <FliesTab trades={trades} search={search} onSearch={onSearch} onOpenTrade={onOpenTrade} />
      ) : (
        <OverviewTab trades={trades} search={search} onSearch={onSearch} onOpenTrade={onOpenTrade} />
      )}
    </div>
  );
}

export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-0.5 py-1 ${active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

function FilterRow({
  search,
  onSearch,
  tickers,
}: {
  search: AnalyticsSearch;
  onSearch: AnalyticsProps["onSearch"];
  tickers: readonly string[];
}) {
  const today = todayNy();
  const preset = activePreset(search, today);
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = customOpen || preset === "custom";
  const books = search.books ? [search.books] : ["live", "paper"];

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
