import { dayText } from "@tj/core";
import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { rText } from "../analytics/format.js";
import type { TradeView } from "../api.js";
import { Chip, Money, strategyChipText } from "../components/ui.js";
import { keyName } from "../keys/keyName.js";
import { useModalLayer } from "../keys/Shortcuts.js";
import { todayNy } from "../market.js";
import type { OpenTrade } from "../nav/tradeList.js";
import { useSetups } from "../review/data.js";
import { contractText } from "../review/text.js";
import { useTrades } from "../routes/Journal.js";
import { matchPages } from "./pages.js";
import { matchTrades, parseTradeQuery } from "./query.js";

const SHOWN = 50;
const NO_TRADES: TradeView[] = [];

/** Ctrl+K, or Cmd+K on a Mac, anywhere: fields included, and taken from the browser's own search bar (spec §7.1). */
export function usePaletteKey(toggle: () => void): void {
  const latest = useRef(toggle);
  latest.current = toggle;
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || keyName(event) !== "k")
        return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, []);
}

function TradeRow({ trade, setup }: { trade: TradeView; setup: string | undefined }) {
  const r = trade.risk?.r ?? trade.missedRisk?.r ?? null;
  return (
    <span className="flex w-full items-center gap-2">
      <span className="num w-14 shrink-0 text-muted">{dayText(trade.openedAt)}</span>
      <span className="num w-32 shrink-0 text-fg">{contractText(trade)}</span>
      <Chip tone={trade.strategy}>{strategyChipText(trade.strategy)}</Chip>
      <Chip tone={trade.book}>{trade.book.toUpperCase()}</Chip>
      <span className="min-w-0 flex-1 truncate text-muted">{setup ?? ""}</span>
      {trade.book !== "missed" && <Money value={trade.netPnl} />}
      <span className="num w-14 shrink-0 text-right">{r == null ? "—" : rText(r)}</span>
    </span>
  );
}

const ITEM = "cursor-pointer rounded-sm px-2 py-1 text-fg data-[selected=true]:bg-[#1c2130]";
const NOTE = "px-2 py-1 text-muted";

/** Ctrl+K (launcher-keys-palette spec §7): pages and tabs, and trades by ticker, day, month, setup, strategy, book. */
export function Palette({
  open,
  onOpenChange,
  onOpenTrade,
  onGo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTrade: OpenTrade;
  onGo: (href: string) => void;
}) {
  const [query, setQuery] = useState("");
  useModalLayer(open);
  const trades = useTrades({}, { enabled: open });
  const { data: setups = [] } = useSetups();
  const today = todayNy();
  const all = trades.data ?? NO_TRADES;
  const context = useMemo(
    () => ({ today, tickers: new Set(all.map((trade) => trade.underlying)), setups }),
    [today, all, setups],
  );
  const words = useMemo(() => parseTradeQuery(query, context), [query, context]);
  const found = useMemo(() => matchTrades(all, words), [all, words]);
  const unknown = words.find((word) => word.kind === "unknown");
  const pages = matchPages(query);
  const setupName = new Map(setups.map((setup) => [setup.id, setup.name]));
  const typed = query.trim();

  const close = () => {
    onOpenChange(false);
    setQuery("");
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      label="Search pages and trades"
      shouldFilter={false}
      loop
      overlayClassName="fixed inset-0 z-40 bg-black/50"
      contentClassName="fixed top-24 left-1/2 z-50 w-[680px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-sm border border-line bg-panel text-[12px] shadow-xl"
    >
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder="A page, or a ticker, day (28/9), month, setup…"
        className="w-full border-line border-b bg-transparent px-3 py-2 text-fg outline-none"
      />
      <Command.List className="max-h-[60vh] overflow-y-auto p-1">
        {pages.length > 0 && (
          <Command.Group heading="Pages" className="text-[10px] text-muted uppercase tracking-wider">
            {pages.map((page) => (
              <Command.Item
                key={page.href}
                value={`page ${page.href}`}
                onSelect={() => {
                  close();
                  onGo(page.href);
                }}
                className={`${ITEM} text-[12px] normal-case tracking-normal`}
              >
                {page.label}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {/* Until the trades load, no ticker is known, so every word would read as unknown. */}
        {typed !== "" && trades.isLoading && <p className={NOTE}>Loading trades…</p>}
        {typed !== "" && trades.error && <p className="px-2 py-1 text-down">Couldn't load trades</p>}
        {typed !== "" && trades.data && unknown && <p className={NOTE}>No trades match '{unknown.text}'</p>}
        {found.length > 0 && (
          <Command.Group
            heading={`Trades · ${found.length}`}
            className="text-[10px] text-muted uppercase tracking-wider"
          >
            {found.slice(0, SHOWN).map((trade) => (
              <Command.Item
                key={trade.id}
                value={`trade ${trade.id}`}
                onSelect={() => {
                  close();
                  onOpenTrade(trade.id, { kind: "ids", ids: found.map((each) => each.id), label: typed });
                }}
                className={`${ITEM} text-[12px] normal-case tracking-normal`}
              >
                <TradeRow trade={trade} setup={trade.setupId ? setupName.get(trade.setupId) : undefined} />
              </Command.Item>
            ))}
            {found.length > SHOWN && (
              <p className={`${NOTE} normal-case tracking-normal`}>
                +{found.length - SHOWN} more · keep typing to narrow
              </p>
            )}
          </Command.Group>
        )}
      </Command.List>
      <div className="border-line border-t px-3 py-1 text-[10px] text-muted">
        ↑↓ move · Enter open · Esc close
      </div>
    </Command.Dialog>
  );
}
