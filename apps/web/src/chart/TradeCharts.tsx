import { addDays, MAX_BAR_DAYS, nyDate, nyMinuteOfDay, type PriceBar, SESSION_END } from "@tj/core";
import { useMemo, useState } from "react";
import { Panel } from "../components/ui.js";
import { TICKER, todayNy } from "../market.js";
import { useDailyBars, useMinuteBars } from "./bars.js";
import { ChartToolbar } from "./ChartToolbar.js";
import { DailyChart } from "./DailyChart.js";
import { IntradayChart } from "./IntradayChart.js";
import { type ChartFill, type ChartTrade, dailyModel, intradayModel } from "./model.js";
import { useChartPrefs } from "./prefs.js";

const NO_BARS: PriceBar[] = [];
const NO_FILLS: ChartFill[] = [];
/** Until 20:16 ET a trade from today can still gain bars (the free data's 15 minutes, and one to spare). */
const LIVE_UNTIL = SESSION_END + 16;

/** The trade page's charts (trade-chart spec §8): the intraday chart, with the daily chart beside it. */
export function TradeCharts({
  trade,
}: {
  trade: {
    underlying: string;
    openedAt: number;
    closedAt: number | null;
    fills?: readonly ChartFill[];
    legs: ChartTrade["legs"];
  };
}) {
  const [prefs, setPrefs] = useChartPrefs();
  const [fitKey, setFitKey] = useState(0);
  const symbol = trade.underlying;
  const firstDay = nyDate(trade.openedAt);
  const lastDay = trade.closedAt != null ? nyDate(trade.closedAt) : todayNy();
  const live = lastDay === todayNy() && nyMinuteOfDay(Date.now()) < LIVE_UNTIL;
  // The warm-up week before the trade, but no more than the server serves: a trade held for months shows its last weeks.
  const weekBefore = addDays(firstDay, -7);
  const earliest = addDays(lastDay, -MAX_BAR_DAYS);
  const minute = useMinuteBars(symbol, weekBefore > earliest ? weekBefore : earliest, lastDay, live);
  const daily = useDailyBars(symbol, lastDay);

  const fills = trade.fills ?? NO_FILLS;
  const chartTrade = useMemo<ChartTrade>(
    () => ({ openedAt: trade.openedAt, closedAt: trade.closedAt, fills, legs: trade.legs }),
    [trade.openedAt, trade.closedAt, fills, trade.legs],
  );
  const bars = minute.data?.bars ?? NO_BARS;
  const dailyBars = daily.data?.bars ?? NO_BARS;
  const intraday = useMemo(
    () => intradayModel(bars, chartTrade, prefs.minutes, prefs.emaLengths),
    [bars, chartTrade, prefs.minutes, prefs.emaLengths],
  );
  const dayChart = useMemo(
    () => dailyModel(dailyBars, bars, chartTrade, prefs.emaLengths, lastDay),
    [dailyBars, bars, chartTrade, prefs.emaLengths, lastDay],
  );

  const message = (text: string) => (
    <Panel title="Chart">
      <p className="text-muted">{text}</p>
    </Panel>
  );
  if (!TICKER.test(symbol)) return message(`No stock bars for ${symbol}.`);
  if (minute.isError) {
    return (
      <Panel title="Chart">
        <div className="flex items-center gap-2">
          <p className="text-down">Alpaca didn't answer. Try again.</p>
          <button
            type="button"
            onClick={() => {
              minute.refetch();
              daily.refetch();
            }}
            className="rounded-sm border border-line px-2 py-0.5 text-fg hover:border-accent"
          >
            Retry
          </button>
        </div>
      </Panel>
    );
  }
  if (minute.isPending) return message("Loading the chart…");
  if (bars.length === 0) return message(minute.data?.unavailable?.message ?? `No stock bars for ${symbol}.`);

  // An EMA needs more history when either chart has nothing of it to draw.
  const hiddenEmas = intraday.emas.flatMap((line, index) =>
    line.points.length === 0 || (dayChart.candles.length > 0 && dayChart.emas[index]?.points.length === 0)
      ? [index]
      : [],
  );
  return (
    <section
      className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel p-2"
      data-testid="trade-charts"
    >
      <ChartToolbar
        prefs={prefs}
        onChange={setPrefs}
        hiddenEmas={hiddenEmas}
        onFit={() => setFitKey((key) => key + 1)}
      />
      {minute.data?.partial && (
        <p className="text-[10px] text-muted">Alpaca's free data runs 15 minutes behind.</p>
      )}
      <div className="grid gap-2 min-[1100px]:grid-cols-[2fr_1fr]">
        <IntradayChart model={intraday} show={prefs.show} fitKey={fitKey} />
        {dayChart.candles.length > 0 ? (
          <DailyChart model={dayChart} show={prefs.show} fitKey={fitKey} />
        ) : (
          <p className="self-center text-center text-muted">
            {daily.isPending
              ? "Loading the daily chart…"
              : daily.isError
                ? "Alpaca didn't answer. Try again."
                : (daily.data?.unavailable?.message ?? `No daily bars for ${symbol}.`)}
          </p>
        )}
      </div>
    </section>
  );
}
