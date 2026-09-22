import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type TradeView } from "../api.js";
import { Chip, Money, Panel, Pct } from "../components/ui.js";

export interface JournalFilter {
  strategy?: "scalp" | "iron_fly";
  book?: "live" | "paper" | "missed";
  includeExcluded?: boolean;
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

export function Journal() {
  const [filter, setFilter] = useState<JournalFilter>({});
  const { data, isLoading, error } = useTrades(filter);

  const toggleBook = (book: JournalFilter["book"]) =>
    setFilter((current) => ({ ...current, book: current.book === book ? undefined : book }));

  return (
    <Panel
      title="Journal"
      right={
        <span className="flex gap-1">
          {BOOKS.map((book) => (
            <button
              key={book}
              type="button"
              onClick={() => toggleBook(book)}
              className={`rounded-[2px] border px-2 py-0.5 uppercase ${
                filter.book === book ? "border-accent bg-[#2962ff1a] text-fg" : "border-line text-muted"
              }`}
            >
              {book}
            </button>
          ))}
        </span>
      }
    >
      {isLoading && <p className="text-muted">Loading…</p>}
      {error && <p className="text-down">Could not load trades: {String(error)}</p>}
      {data?.length === 0 && (
        <p className="text-muted">No trades yet. Add one from Iron Flies → New trade.</p>
      )}
      {data && data.length > 0 && (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-[9px] text-muted uppercase tracking-wider">
              <th className="py-1 text-left font-medium">Opened</th>
              <th className="text-left font-medium">Symbol</th>
              <th className="text-left font-medium">Strategy</th>
              <th className="text-left font-medium">Book</th>
              <th className="text-right font-medium">Net P&amp;L</th>
              <th className="text-right font-medium">Return on risk</th>
              <th className="text-right font-medium">Grade</th>
            </tr>
          </thead>
          <tbody>
            {data.map((trade) => (
              <tr key={trade.id} className="border-line border-t">
                <td className="num py-1 text-muted">{ET.format(new Date(trade.openedAt))}</td>
                <td>
                  <a className="text-fg hover:text-[#82a8ff]" href={`/trades/${trade.id}`}>
                    {trade.underlying}
                  </a>
                </td>
                <td>
                  <Chip tone={trade.strategy}>{trade.strategy === "iron_fly" ? "IRON FLY" : "SCALP"}</Chip>
                </td>
                <td>
                  <Chip tone={trade.book}>{trade.book.toUpperCase()}</Chip>{" "}
                  {trade.excluded && <Chip tone="excluded">EXCLUDED</Chip>}
                </td>
                <td className="text-right">
                  <Money value={trade.netPnl} />
                </td>
                <td className="text-right">
                  <Pct value={trade.metrics?.returnOnRisk ?? null} />
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
