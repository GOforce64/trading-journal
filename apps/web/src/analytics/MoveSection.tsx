import { ivCrushHistogram, type MoveRow, movePoints, moveRatioBuckets, type RatioSummary } from "@tj/core";
import { fillSummary, MOVE_COPY, useFilling, useFillMoves, useMarketOn } from "../moves.js";
import { dollars } from "./format.js";
import { CrushHistogram, MoveScatter } from "./MoveCharts.js";
import { Section } from "./Section.js";

const tone = (value: number) => (value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted");
const trades = (count: number) => `${count} ${count === 1 ? "trade" : "trades"}`;

function RatioTable({ summary }: { summary: RatioSummary }) {
  const widest = Math.max(1, ...summary.buckets.map((bucket) => Math.abs(bucket.net)));
  const beyond = summary.beyondImplied;
  return (
    <>
      <table className="w-full border-collapse text-[11px]">
        <thead className="text-[9px] text-muted uppercase tracking-wider">
          <tr>
            <th className="text-left font-medium">Actual ÷ implied</th>
            <th className="text-right font-medium">Trades</th>
            <th className="text-right font-medium">Won</th>
            <th className="text-right font-medium">Net</th>
          </tr>
        </thead>
        <tbody>
          {summary.buckets.map((bucket) => (
            <tr key={bucket.label} className="border-line border-t">
              <td className="py-0.5">{bucket.label}</td>
              <td className="num text-right text-muted">{bucket.trades}</td>
              <td className="num text-right text-muted">{bucket.won}</td>
              <td className="w-36">
                <div className="flex items-center justify-end gap-1.5">
                  <span className={`num ${tone(bucket.net)}`}>{dollars(bucket.net)}</span>
                  <span className="flex w-12">
                    <span
                      className={`h-[7px] rounded-[1px] ${bucket.net >= 0 ? "bg-up" : "bg-down"}`}
                      style={{ width: `${(Math.abs(bucket.net) / widest) * 100}%` }}
                    />
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-muted">
        Moved more than implied: {trades(beyond.trades)}, {beyond.won} won, net {dollars(beyond.net)}.
      </p>
    </>
  );
}

/** Implied vs actual move, P&L by move ratio and IV crush, for the tab's closed flies (spec §9.4). */
export function MoveSection({
  flies,
  tickers,
}: {
  flies: readonly MoveRow[];
  tickers: ReadonlyMap<string, string>;
}) {
  const points = movePoints(flies);
  const ratios = moveRatioBuckets(flies);
  const crush = ivCrushHistogram(flies);
  const marketOn = useMarketOn();
  const fetching = useFilling();
  const fill = useFillMoves();

  return (
    <div className="flex flex-col gap-2">
      <p data-testid="move-coverage" className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>
          Move data for {points.length} of {flies.length} closed flies
        </span>
        {points.length < flies.length && (
          <button
            type="button"
            disabled={!marketOn || fetching}
            title={marketOn ? undefined : MOVE_COPY.noKey}
            onClick={() => fill.mutate(undefined)}
            className="rounded-sm border border-accent bg-[#2962ff1a] px-2 py-0.5 text-fg disabled:opacity-50"
          >
            {fetching ? MOVE_COPY.fetching : "Fill in missing"}
          </button>
        )}
        {fill.data && <span>{fillSummary(fill.data)}</span>}
      </p>
      <div className="grid gap-2 lg:grid-cols-3">
        <Section title="Implied vs actual move">
          {points.length === 0 ? (
            <p className="text-muted">No move data in this range.</p>
          ) : (
            <MoveScatter points={points} />
          )}
        </Section>
        <Section title="P&L by move ratio">
          <RatioTable summary={ratios} />
        </Section>
        <Section title="IV crush">
          {crush.count === 0 ? (
            <p className="text-muted">No IV data in this range.</p>
          ) : (
            <>
              <CrushHistogram bins={crush.bins} tickers={tickers} />
              <p className="text-[10px] text-muted">
                Median crush {Math.round(crush.median ?? 0)} pts over {trades(crush.count)}. IV after is left
                blank within 24 h of expiry.
              </p>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
