import type { TradeNav } from "./useTradeNav.js";

/** "4 of 41 · Journal · Paper" (spec §5), and a key's failed save. Nothing for the queue or no list. */
export function TradeNavLine({ nav, error }: { nav: TradeNav; error?: string | null }) {
  if (!nav.place && !error) return null;
  return (
    <div data-testid="trade-nav" className="flex items-center gap-3 text-[11px] text-muted">
      {nav.place && (
        <span className="num">
          {nav.place.position} of {nav.place.total} · {nav.place.label}
        </span>
      )}
      {nav.place && <span>J next · K previous</span>}
      {error && <span className="text-down">Couldn't save: {error}</span>}
    </div>
  );
}
