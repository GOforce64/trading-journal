import { closedTrades, nyDate, type SetupCard, setupCards } from "@tj/core";
import type { ReactNode } from "react";
import type { TradeView } from "../api.js";
import { Chip } from "../components/ui.js";
import { todayNy } from "../market.js";
import type { Setup } from "../review/data.js";
import { strategyLabel } from "../review/text.js";
import { dollars, profitFactorText, rText, shareText, winRateText } from "./format.js";
import { Section } from "./Section.js";
import { Sparkline } from "./Sparkline.js";
import { returnText } from "./scalpText.js";

const ET_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});
const ET_DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const tone = (value: number | null) => {
  if (value == null || value === 0) return "";
  return value > 0 ? "text-up" : "text-down";
};

/** "Sep 28", with the year when it isn't this one: "Sep 17, 2025". */
function lastText(closedAt: number, today: string): string {
  const format = nyDate(closedAt).slice(0, 4) === today.slice(0, 4) ? ET_DAY : ET_DAY_YEAR;
  return format.format(new Date(closedAt));
}

function Stat({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div>
      <div className="whitespace-nowrap text-[9px] text-muted uppercase tracking-wider">{label}</div>
      <div className={`num text-[12px] ${className}`}>{children}</div>
    </div>
  );
}

function Card({
  card,
  setup,
  today,
  onOpen,
}: {
  card: SetupCard;
  setup: Setup;
  today: string;
  onOpen?: (setupId: string, tab: "scalps" | "flies") => void;
}) {
  const fly = card.kind === "fly";
  const hero = fly ? card.kept : card.avgR;
  return (
    <article aria-label={setup.name} className="flex flex-col rounded-sm border border-line bg-panel p-2.5">
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] text-fg">{setup.name}</span>
        <Chip tone={setup.strategy ?? "default"}>{strategyLabel(setup.strategy)}</Chip>
      </div>
      <p className="mt-0.5 h-4 truncate text-[10px] text-muted">{setup.description ?? ""}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div>
          <div className="text-[9px] text-muted uppercase tracking-wider">{fly ? "Kept" : "Avg R"}</div>
          <div data-testid="card-hero" className={`num text-[20px] ${tone(hero)}`}>
            {fly ? shareText(card.kept) : card.avgR == null ? "—" : rText(card.avgR)}
          </div>
          <div className="text-[9px] text-muted">
            {fly ? "of max profit" : `over ${card.rCount} of ${card.trades}`}
          </div>
        </div>
        <Sparkline
          points={card.points}
          format={fly ? dollars : rText}
          label={fly ? "Cumulative net P&L" : "Cumulative R"}
        />
      </div>
      {/* Spread by content rather than four equal columns, which wrapped "Avg return" on a narrow card. */}
      <div className="mt-2 flex justify-between gap-2">
        <Stat label="Trades">{card.trades}</Stat>
        <Stat label="Win %">{winRateText(card.winRate)}</Stat>
        <Stat label="Net" className={tone(card.net)}>
          {dollars(card.net)}
        </Stat>
        {fly ? (
          <Stat label="PF">{profitFactorText(card.profitFactor)}</Stat>
        ) : (
          <Stat label="Avg return" className={tone(card.avgReturn)}>
            {returnText(card.avgReturn)}
          </Stat>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between border-line border-t pt-1.5 text-[10px] text-muted">
        <span>last {lastText(card.lastClosedAt, today)}</span>
        <button
          type="button"
          onClick={() => onOpen?.(card.setupId, fly ? "flies" : "scalps")}
          className="text-accent hover:underline"
        >
          {card.trades} {card.trades === 1 ? "trade" : "trades"} →
        </button>
      </div>
    </article>
  );
}

/** A card per setup with closed trades, all time, both books, excluded trades left out (scalp-analytics spec §7). */
export function SetupCards({
  trades,
  setups,
  showArchived,
  onOpenSetup,
  today = todayNy(),
}: {
  /** Every trade; undefined while they load. */
  trades: readonly TradeView[] | undefined;
  setups: readonly Setup[];
  showArchived: boolean;
  onOpenSetup?: (setupId: string, tab: "scalps" | "flies") => void;
  /** New York's date, YYYY-MM-DD; the year decides whether a date shows its own. */
  today?: string;
}) {
  const shown = new Map(
    setups.filter((setup) => showArchived || !setup.archived).map((setup) => [setup.id, setup]),
  );
  const names = new Map(setups.map((setup) => [setup.id, setup.name]));
  const cards = trades
    ? setupCards(closedTrades(trades.filter((trade) => !trade.excluded)), names).filter((card) =>
        shown.has(card.setupId),
      )
    : [];
  let body: ReactNode;
  if (!trades) body = <p className="text-muted">Loading…</p>;
  else if (cards.length === 0)
    body = <p className="text-muted">Tag trades with a setup to see its stats here.</p>;
  else {
    body = (
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const setup = shown.get(card.setupId);
          return (
            setup && <Card key={card.setupId} card={card} setup={setup} today={today} onOpen={onOpenSetup} />
          );
        })}
      </div>
    );
  }
  return <Section title="Setup stats · all time">{body}</Section>;
}
