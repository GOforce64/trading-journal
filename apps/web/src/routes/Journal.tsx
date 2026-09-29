import { useQuery } from "@tanstack/react-query";
import { closeEstimate, type OptionQuote, pctKept } from "@tj/core";
import { useState } from "react";
import { api, type TradeView } from "../api.js";
import { EstimatedPnl } from "../components/Estimate.js";
import { Chip, Money, Panel, Pct } from "../components/ui.js";
import { isOpen, openContracts, todayNy, useOptionQuotes, useQuotes } from "../market.js";
import { useSetups } from "../review/data.js";

export interface JournalFilter {
  strategy?: "scalp" | "iron_fly";
  book?: "live" | "paper" | "missed";
  includeExcluded?: boolean;
  /** Only the scalps waiting for review, oldest first (scalp-review spec §9.3). */
  review?: "pending";
}

const BOOKS = ["live", "paper", "missed"] as const;

export function useTrades(filter: JournalFilter) {
  return useQuery({
    queryKey: ["trades", filter],
    queryFn: async (): Promise<TradeView[]> => {
      const res = await api.api.trades.$get({
        query: {
          strategy: filter.strategy,
          book: filter.book,
          includeExcluded: filter.includeExcluded ? "true" : undefined,
          review: filter.review,
        },
      });
      if (!res.ok) throw new Error(`list trades failed: ${res.status}`);
      return res.json();
    },
  });
}

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const PRICE = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const NO_QUOTES = new Map<string, OptionQuote>();

function LivePrice({ tradeId, quote }: { tradeId: string; quote?: { price: number; at: number } }) {
  if (!quote) return null;
  return (
    <span
      data-testid={`price-${tradeId}`}
      title={`Last trade ${ET.format(new Date(quote.at))} ET, IEX. For reference only.`}
      className="num ml-1.5 text-muted"
    >
      {PRICE.format(quote.price)}
    </span>
  );
}

export interface JournalProps {
  /** Fixed part of the filter, e.g. the Iron Flies page pins the strategy. */
  lockedFilter?: JournalFilter;
  title?: string;
  actions?: React.ReactNode;
  onOpenTrade?: (id: string) => void;
  /** What an empty list says. */
  emptyText?: string;
}

export function Journal({ lockedFilter, title = "Journal", actions, onOpenTrade, emptyText }: JournalProps) {
  const [book, setBook] = useState<JournalFilter["book"]>(undefined);
  const { data, isLoading, error } = useTrades({ ...lockedFilter, book });
  const { data: setups } = useSetups();
  const setupNames = new Map((setups ?? []).map((setup) => [setup.id, setup.name]));
  const { data: quotes } = useQuotes(data?.map((trade) => trade.underlying) ?? []);
  const today = todayNy();
  // One call for the open legs of every open trade on screen; the server splits it for Alpaca.
  const { data: optionQuotes } = useOptionQuotes(
    data?.filter(isOpen).flatMap((trade) => openContracts(trade, today)) ?? [],
  );

  return (
    <Panel
      title={title}
      right={
        <span className="flex items-center gap-1">
          {BOOKS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setBook((current) => (current === option ? undefined : option))}
              className={`rounded-[2px] border px-2 py-0.5 uppercase ${
                book === option ? "border-accent bg-[#2962ff1a] text-fg" : "border-line text-muted"
              }`}
            >
              {option}
            </button>
          ))}
          {actions}
        </span>
      }
    >
      {isLoading && <p className="text-muted">Loading…</p>}
      {error && <p className="text-down">Could not load trades: {String(error)}</p>}
      {data?.length === 0 && (
        <p className="text-muted">{emptyText ?? "No trades yet. Add one from Iron Flies → New trade."}</p>
      )}
      {data && data.length > 0 && (
        <table className="w-full table-fixed border-collapse text-[12px]">
          <thead>
            <tr className="text-[9px] text-muted uppercase tracking-wider">
              <th className="w-36 py-1 text-left font-medium">Opened</th>
              <th className="w-32 text-left font-medium">Symbol</th>
              <th className="w-24 text-left font-medium">Strategy</th>
              <th className="w-32 text-left font-medium">Book</th>
              <th className="w-36 text-left font-medium">Setup</th>
              <th className="text-left font-medium">Notes</th>
              <th className="w-28 text-right font-medium">Net P&amp;L</th>
              <th className="w-28 text-right font-medium">% kept</th>
              <th className="w-12 text-right font-medium">Grade</th>
            </tr>
          </thead>
          <tbody>
            {data.map((trade) => (
              // The whole row opens the trade; hovering makes that obvious.
              <tr
                key={trade.id}
                data-testid={`row-${trade.id}`}
                tabIndex={0}
                onClick={() => onOpenTrade?.(trade.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenTrade?.(trade.id);
                  }
                }}
                className="cursor-pointer border-line border-t hover:bg-[#1c2130] focus:bg-[#1c2130] focus:outline-none"
              >
                <td className="num whitespace-nowrap py-1 pr-3 text-muted">
                  {ET.format(new Date(trade.openedAt))}
                </td>
                <td className="whitespace-nowrap text-fg">
                  {trade.review?.status === "pending" && (
                    <>
                      <span
                        aria-hidden="true"
                        title="To review"
                        className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle"
                      />
                      <span className="sr-only">Waiting for review</span>
                    </>
                  )}
                  {trade.underlying}
                  <LivePrice tradeId={trade.id} quote={quotes?.[trade.underlying]} />
                </td>
                <td>
                  <Chip tone={trade.strategy}>{trade.strategy === "iron_fly" ? "IRON FLY" : "SCALP"}</Chip>
                </td>
                <td>
                  <Chip tone={trade.book}>{trade.book.toUpperCase()}</Chip>{" "}
                  {trade.excluded && <Chip tone="excluded">EXCLUDED</Chip>}
                </td>
                <td className="truncate pr-3 text-muted">{setupNames.get(trade.setupId ?? "") ?? "—"}</td>
                <td className="max-w-0 pr-3">
                  <span
                    data-testid={`note-${trade.id}`}
                    title={trade.notes ?? undefined}
                    className="block truncate text-muted"
                  >
                    {trade.notes ?? ""}
                  </span>
                </td>
                <td className="text-right">
                  {isOpen(trade) ? (
                    <EstimatedPnl
                      estimate={closeEstimate(trade, optionQuotes?.quotes ?? NO_QUOTES, today)}
                      explain={optionQuotes?.available === true}
                      testId={`est-${trade.id}`}
                    />
                  ) : (
                    <Money value={trade.netPnl} />
                  )}
                </td>
                <td className="text-right">
                  <Pct value={pctKept(trade)} />
                </td>
                <td className="num text-right text-muted">{trade.grade ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
