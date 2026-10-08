import { isTradingDay, nyMinuteOfDay, PREMARKET_OPEN, type PriceBar, SESSION_END } from "@tj/core";
import { type ReactNode, useMemo, useState } from "react";
import { Panel } from "../components/ui.js";
import { TICKER, todayNy } from "../market.js";
import { barRange, useDailyBars, useMinuteBars, useOptionBars } from "./bars.js";
import { ChartToolbar } from "./ChartToolbar.js";
import { DailyChart } from "./DailyChart.js";
import type { ChartEditing } from "./drag.js";
import { IntradayChart, type PriceLine } from "./IntradayChart.js";
import { type ChartFill, type ChartTrade, dailyModel, intradayModel } from "./model.js";
import { arriveBy, type ChartView, clockText } from "./option.js";
import { useChartPrefs } from "./prefs.js";

const NO_BARS: PriceBar[] = [];
const NO_FILLS: ChartFill[] = [];
/** Until 20:16 ET a trade from today can still gain bars (the free data's 15 minutes, and one to spare). */
const LIVE_UNTIL = SESSION_END + 16;
/** The intraday chart's height, which the option view's messages keep so the page doesn't jump. */
const CHART_HEIGHT = 420;

interface OptionAnswer {
  partial: boolean;
  delayMinutes: number;
  unavailable: { reason: string; message: string } | null;
}

/** Why the option view has nothing to draw (premium-chart spec §8). */
function optionEmptyText(answer: OptionAnswer, openedAt: number, name: string): string {
  const reason = answer.unavailable?.reason;
  if (answer.unavailable && (reason === "no_key" || reason === "too_old")) return answer.unavailable.message;
  if (answer.partial) {
    return `This contract's bars from ${clockText(openedAt)} arrive by ${arriveBy(openedAt, answer.delayMinutes)}.`;
  }
  return `No option bars for ${name}.`;
}

/** The trade page's charts (trade-chart spec §8): the intraday chart, with the daily chart beside it. */
export function TradeCharts({
  trade,
  levels,
  option,
}: {
  trade: {
    underlying: string;
    openedAt: number;
    closedAt: number | null;
    fills?: readonly ChartFill[];
    legs: ChartTrade["legs"];
  };
  /** A scalp's stop and target, and what placing and dragging them does (scalp-review spec §8). */
  levels?: { lines: readonly PriceLine[]; editing: ChartEditing };
  /** A scalp's contract and the Stock | Option switch (premium-chart spec §6). */
  option?: { contract: string; name: string; view: ChartView; onView: (view: ChartView) => void };
}) {
  const [prefs, setPrefs] = useChartPrefs();
  const [fitKey, setFitKey] = useState(0);
  const symbol = trade.underlying;
  const { from, lastDay } = barRange(trade);
  // Today's bars grow only on a session day, from the premarket open until 20:16.
  const today = todayNy();
  const clock = nyMinuteOfDay(Date.now());
  const live = lastDay === today && isTradingDay(today) && clock >= PREMARKET_OPEN && clock < LIVE_UNTIL;
  const minute = useMinuteBars(symbol, from, lastDay, live);
  const daily = useDailyBars(symbol, lastDay);
  const optionBars = useOptionBars(option?.contract ?? null, from, lastDay);

  const fills = trade.fills ?? NO_FILLS;
  const chartTrade = useMemo<ChartTrade>(
    () => ({ openedAt: trade.openedAt, closedAt: trade.closedAt, fills, legs: trade.legs }),
    [trade.openedAt, trade.closedAt, fills, trade.legs],
  );
  const bars = minute.data?.bars ?? NO_BARS;
  const dailyBars = daily.data?.bars ?? NO_BARS;
  const contractBars = optionBars.data?.bars ?? NO_BARS;
  const intraday = useMemo(
    () => intradayModel(bars, chartTrade, prefs.minutes, prefs.emaLengths),
    [bars, chartTrade, prefs.minutes, prefs.emaLengths],
  );
  const optionModel = useMemo(
    () => intradayModel(contractBars, chartTrade, prefs.minutes, prefs.emaLengths, { slots: true }),
    [contractBars, chartTrade, prefs.minutes, prefs.emaLengths],
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
  // A failed live refresh keeps the chart that's drawn (below); only a first load that failed shows this.
  if (minute.isError && !minute.data) {
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

  const onOption = option?.view === "option";
  const shown = onOption ? optionModel : intraday;
  // An EMA needs more history when its chart has nothing of it to draw; the stock view looks at the daily chart too.
  const hiddenEmas = shown.emas.flatMap((line, index) =>
    line.points.length === 0 ||
    (!onOption && dayChart.candles.length > 0 && dayChart.emas[index]?.points.length === 0)
      ? [index]
      : [],
  );

  let banner: ReactNode = null;
  if (onOption) {
    if (optionBars.isError && optionBars.data) {
      banner = (
        <p className="text-[10px] text-down">
          Couldn't refresh the option chart: Alpaca didn't answer. Trying again in a minute.
        </p>
      );
    } else if (optionBars.data?.partial) {
      banner = (
        <p className="text-[10px] text-muted">
          Alpaca's free option data runs up to {optionBars.data.delayMinutes} minutes behind.
        </p>
      );
    }
  } else if (minute.isError) {
    banner = (
      <p className="text-[10px] text-down">
        Couldn't refresh the chart: Alpaca didn't answer. Trying again in a minute.
      </p>
    );
  } else if (minute.data?.partial) {
    banner = <p className="text-[10px] text-muted">Alpaca's free data runs 15 minutes behind.</p>;
  }

  // The option view's cell when there's nothing to draw yet, the chart's height so the page doesn't jump.
  const placeholder = (children: ReactNode) => (
    <div className="flex items-center justify-center gap-2 text-center" style={{ height: CHART_HEIGHT }}>
      {children}
    </div>
  );
  let optionCell: ReactNode = null;
  if (onOption && option) {
    if (optionBars.isError && !optionBars.data) {
      optionCell = placeholder(
        <>
          <p className="text-down">Alpaca didn't answer.</p>
          <button
            type="button"
            aria-label="Retry the option chart"
            onClick={() => optionBars.refetch()}
            className="rounded-sm border border-line px-2 py-0.5 text-fg hover:border-accent"
          >
            Retry
          </button>
        </>,
      );
    } else if (optionBars.isPending) {
      optionCell = placeholder(<p className="text-muted">Loading the option chart…</p>);
    } else if (contractBars.length === 0 && optionBars.data) {
      optionCell = placeholder(
        <p className="text-muted">{optionEmptyText(optionBars.data, trade.openedAt, option.name)}</p>,
      );
    }
  }

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
        view={option ? { current: option.view, onChange: option.onView } : undefined}
      />
      {banner}
      <div className="grid gap-2 min-[1100px]:grid-cols-[2fr_1fr]">
        {optionCell ?? (
          <IntradayChart
            model={shown}
            show={prefs.show}
            fitKey={fitKey}
            height={CHART_HEIGHT}
            lines={levels?.lines}
            editing={levels?.editing}
            markersAtPrice={onOption}
            viewKey={onOption ? "option" : "stock"}
          />
        )}
        {/* Only once the daily bars are in: before, today's candle alone would stand for the whole chart. */}
        {daily.isSuccess && !daily.data.unavailable && dayChart.candles.length > 0 ? (
          <DailyChart model={dayChart} show={prefs.show} fitKey={fitKey} />
        ) : daily.isError ? (
          <div className="flex items-center justify-center gap-2 self-center">
            <p className="text-down">Couldn't load the daily chart: Alpaca didn't answer.</p>
            <button
              type="button"
              aria-label="Retry the daily chart"
              onClick={() => daily.refetch()}
              className="rounded-sm border border-line px-2 py-0.5 text-fg hover:border-accent"
            >
              Retry
            </button>
          </div>
        ) : (
          <p className="self-center text-center text-muted">
            {daily.isPending
              ? "Loading the daily chart…"
              : (daily.data?.unavailable?.message ?? `No daily bars for ${symbol}.`)}
          </p>
        )}
      </div>
    </section>
  );
}
