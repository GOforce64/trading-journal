import { nyWallClock, regularClose } from "@tj/core";
import { useMemo, useState } from "react";
import type { ChartEditing, PointMark } from "../chart/drag.js";
import { TradeCharts } from "../chart/TradeCharts.js";
import { Chip, Panel } from "../components/ui.js";
import { useCreateMissed } from "./data.js";

const INPUT =
  "num w-[4.6rem] rounded-sm border border-line bg-[#0e1118] px-1.5 py-0.5 text-fg outline-none focus:border-accent";
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
/** No points yet, which keeps the session's open and close marks off the chart (missed-trades spec §6.4). */
const NO_POINTS: readonly PointMark[] = [];

/**
 * A new missed trade (missed-trades spec §6.2): the day's chart, ready for a click on the entry. Nothing exists until
 * that click, or a typed entry when the chart has nothing to click, creates the trade.
 */
export function NewMissed({
  symbol,
  date,
  onCreated,
}: {
  symbol: string;
  /** YYYY-MM-DD, New York. */
  date: string;
  onCreated: (id: string) => void;
}) {
  const create = useCreateMissed();
  const [time, setTime] = useState("");
  const [price, setPrice] = useState("");
  const dayText = DAY.format(new Date(`${date}T00:00:00Z`));
  const chartTrade = useMemo(
    () => ({
      underlying: symbol,
      openedAt: nyWallClock(date, 9 * 60 + 30),
      closedAt: nyWallClock(date, regularClose(date)),
      legs: [],
      fills: [],
    }),
    [symbol, date],
  );
  const make = (openedAt: number, entryPrice: number) =>
    create.mutate(
      { underlying: symbol, openedAt, entryPrice },
      { onSuccess: (trade) => onCreated(trade.id) },
    );

  const editing: ChartEditing = {
    placing: create.isPending ? null : "entry",
    onPlace: () => {},
    onDrag: () => {},
    onDrop: () => {},
    onCancel: () => {},
    onPlacePoint: (_id, t, at) => make(t, at),
  };

  const typed = (() => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    const value = Number(price);
    if (!match || !Number.isFinite(value) || value <= 0) return null;
    return { openedAt: nyWallClock(date, Number(match[1]) * 60 + Number(match[2])), entryPrice: value };
  })();

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="num font-semibold text-[16px]">{symbol}</h1>
        <Chip tone="missed">MISSED</Chip>
        <span className="text-muted">New missed trade · {dayText}</span>
      </header>
      <div className="grid items-start gap-3 lg:grid-cols-[2fr_1fr]">
        <TradeCharts
          trade={chartTrade}
          daily={false}
          levels={{ lines: [], editing }}
          points={NO_POINTS}
          emptyText={`No bars for ${symbol} on ${dayText}. Check the ticker.`}
        />
        <Panel title="Missed trade">
          <p className="mb-2 text-fg">Click the chart to place the entry</p>
          <p className="mb-2 text-[11px] text-muted">Or type it:</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              aria-label="Entry time"
              placeholder="09:41"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className={INPUT}
            />
            <input
              aria-label="Entry price"
              placeholder="price"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className={INPUT}
            />
            <button
              type="button"
              disabled={!typed || create.isPending}
              onClick={() => typed && make(typed.openedAt, typed.entryPrice)}
              className="rounded-sm border border-accent bg-accent px-2 py-0.5 text-white disabled:opacity-40"
            >
              Create
            </button>
          </div>
          {create.error && <p className="mt-2 text-down">Couldn't create it: {create.error.message}</p>}
        </Panel>
      </div>
    </div>
  );
}
