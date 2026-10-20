import { isTradingDay, nyMinuteOfDay, PREMARKET_OPEN, type PriceBar, SESSION_END } from "@tj/core";
import { type ReactNode, useMemo, useState } from "react";
import { TICKER, todayNy } from "../market.js";
import { barRange, useDailyBars, useMinuteBars } from "./bars.js";
import { BUTTON, on } from "./ChartToolbar.js";
import { DailyChart } from "./DailyChart.js";
import type { PriceLine } from "./IntradayChart.js";
import type { Toggle } from "./prefs.js";
import { useChartPrefs } from "./prefs.js";
import { type SwingChartTrade, type SwingPeriod, swingChartModel } from "./swing.js";

const NO_BARS: PriceBar[] = [];
const NO_LINES: readonly PriceLine[] = [];
/** Until 20:16 ET a trade from today can still gain bars (the free data's 15 minutes, and one to spare). */
const LIVE_UNTIL = SESSION_END + 16;
const HEIGHT = 420;
const PERIODS: readonly { id: SwingPeriod; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
];
export const WEEKLY_EMA_TITLE = "Needs more history than a weekly chart has";

/**
 * A swing's chart (swing spec §5.4): daily or weekly candles across the page up to today, its fills, its strike lines.
 */
export function SwingChart({
  trade,
  lines = NO_LINES,
}: {
  trade: SwingChartTrade & { underlying: string };
  lines?: readonly PriceLine[];
}) {
  const [prefs, setPrefs] = useChartPrefs();
  const [fitKey, setFitKey] = useState(0);
  const period = prefs.swingPeriod;
  const symbol = trade.underlying;
  const today = todayNy();
  const clock = nyMinuteOfDay(Date.now());
  // The chart runs to today, past a closed swing's exit, to show what the stock did after it. Today's candle is built
  // from minute bars.
  const live = isTradingDay(today) && clock >= PREMARKET_OPEN && clock < LIVE_UNTIL;
  const minute = useMinuteBars(symbol, today, today, live);
  const toToday = useDailyBars(symbol, today, true, period);
  // Without a key the days after the exit can't be fetched (the demo has none): the chart then ends at the exit.
  const { lastDay } = barRange(trade);
  const toExit = lastDay < today && toToday.data?.unavailable?.reason === "no_key";
  const atExit = useDailyBars(symbol, lastDay, toExit, period);
  const daily = toExit ? atExit : toToday;
  const end = toExit ? lastDay : today;
  const minuteBars = minute.data?.bars ?? NO_BARS;
  const dailyBars = daily.data?.bars ?? NO_BARS;
  const model = useMemo(
    () => swingChartModel(dailyBars, minuteBars, trade, prefs.emaLengths, end, period),
    [dailyBars, minuteBars, trade, prefs.emaLengths, end, period],
  );
  const starved = model.emas.flatMap((line, index) => (line.points.length === 0 ? [index] : []));

  const toggle = (name: Toggle) => setPrefs({ ...prefs, show: { ...prefs.show, [name]: !prefs.show[name] } });
  const toolbar = (
    <div className="flex flex-wrap items-center gap-1">
      {PERIODS.map((each) => (
        <button
          key={each.id}
          type="button"
          aria-pressed={period === each.id}
          onClick={() => setPrefs({ ...prefs, swingPeriod: each.id })}
          className={`${BUTTON} ${on(period === each.id)}`}
        >
          {each.label}
        </button>
      ))}
      <span aria-hidden className="mx-1 h-3 w-px bg-line" />
      {prefs.emaLengths.map((length, index) => {
        const name = `ema${index}` as Toggle;
        const hungry = starved.includes(index);
        const disabled = period === "weekly" && hungry && daily.isSuccess;
        return (
          <button
            key={name}
            type="button"
            aria-pressed={prefs.show[name] && !disabled}
            disabled={disabled}
            title={disabled ? WEEKLY_EMA_TITLE : hungry ? "needs more history" : undefined}
            onClick={() => toggle(name)}
            className={`${BUTTON} ${on(prefs.show[name] && !disabled)} disabled:opacity-40`}
          >
            EMA {length}
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={prefs.show.volume}
        onClick={() => toggle("volume")}
        className={`${BUTTON} ${on(prefs.show.volume)}`}
      >
        Volume
      </button>
      <button
        type="button"
        onClick={() => setFitKey((key) => key + 1)}
        className={`${BUTTON} ml-auto border-line text-muted hover:text-fg`}
      >
        Fit trade
      </button>
    </div>
  );

  const message = (children: ReactNode) => (
    <div className="flex items-center justify-center gap-2 text-center" style={{ height: HEIGHT }}>
      {children}
    </div>
  );
  let body: ReactNode;
  if (!TICKER.test(symbol)) body = message(<p className="text-muted">No stock bars for {symbol}.</p>);
  else if (daily.isError) {
    body = message(
      <>
        <p className="text-down">Couldn't load the chart: Alpaca didn't answer.</p>
        <button
          type="button"
          aria-label="Retry the chart"
          onClick={() => daily.refetch()}
          className="rounded-sm border border-line px-2 py-0.5 text-fg hover:border-accent"
        >
          Retry
        </button>
      </>,
    );
  } else if (daily.isPending) body = message(<p className="text-muted">Loading the chart…</p>);
  else if (daily.data.unavailable || model.candles.length === 0) {
    body = message(
      <p className="text-muted">{daily.data.unavailable?.message ?? `No daily bars for ${symbol}.`}</p>,
    );
  } else {
    body = <DailyChart model={model} show={prefs.show} fitKey={fitKey} height={HEIGHT} lines={lines} />;
  }

  return (
    <section
      className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel p-2"
      data-testid="swing-chart"
    >
      {toolbar}
      {body}
    </section>
  );
}
