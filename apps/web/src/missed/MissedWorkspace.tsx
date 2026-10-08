import {
  type Direction,
  GRADES,
  type MissedLevels,
  missedRisk,
  nyDate,
  nyWallClock,
  regularClose,
} from "@tj/core";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { rText } from "../analytics/format.js";
import type { TradeDetailView } from "../api.js";
import { barRange, useMinuteBars } from "../chart/bars.js";
import { contextMarks } from "../chart/context.js";
import type { ChartEditing, PointMark } from "../chart/drag.js";
import type { PriceLine } from "../chart/IntradayChart.js";
import { clockText } from "../chart/option.js";
import { TradeCharts } from "../chart/TradeCharts.js";
import { Chip, Panel } from "../components/ui.js";
import { type TradePatchBody, useSaveTrade } from "../review/data.js";
import { SetupPicker, TagChips } from "../review/Pickers.js";
import { useAutoFillPrices, useRangeProblem } from "../review/prices.js";
import { Screenshots } from "../screenshots/Screenshots.js";
import { useDayTrades, useDeleteMissed } from "./data.js";
import { dayText, excursionLine, missedLine, parseClock, rangeWarning } from "./text.js";

const LABEL = "w-14 shrink-0 text-[10px] text-muted uppercase tracking-wider";
const INPUT =
  "num w-[4.6rem] rounded-sm border border-line bg-[#0e1118] px-1.5 py-0.5 text-fg outline-none focus:border-accent";
const SMALL_BUTTON = "rounded-[2px] border border-line px-1.5 py-0.5 text-[10px] text-muted hover:text-fg";
const STOP_COLOR = "#ef5350";
const TARGET_COLOR = "#26a69a";
/** A trade created this recently has just come from the new-trade page, so placing goes on with the stop. */
const JUST_CREATED_MS = 60_000;

type Placing = "stop" | "target" | "exit" | null;

const price = (value: number | null | undefined) => (value == null ? "" : value.toFixed(2));

/** A typed price above 0, or a message. */
function parsePrice(text: string): number | string {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(value) && value > 0 ? value : "Type a price above 0";
}

/** One typed value: saves on blur or Enter, shows what the save refused, and a warning that doesn't stop it. */
function Field({
  label,
  value,
  onCommit,
  warning,
  refused,
}: {
  label: string;
  value: string;
  /** Saves the text, or answers why it can't. */
  onCommit: (text: string) => string | null;
  warning?: string | null;
  /** Why the server refused the field's last save (spec §9). */
  refused?: string | null;
}) {
  const [text, setText] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text === value) return;
    setProblem(onCommit(text));
  };
  return (
    <span className="flex flex-col">
      <input
        aria-label={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setText(value);
        }}
        className={INPUT}
      />
      {(problem ?? refused ?? warning) && (
        <span className={`text-[10px] ${(problem ?? refused) ? "text-down" : "text-[#f5b041]"}`}>
          {problem ?? refused ?? warning}
        </span>
      )}
    </span>
  );
}

function Row({
  label,
  labelClass = "",
  children,
}: {
  label: string;
  labelClass?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      <span className={`${LABEL} pt-1 ${labelClass}`}>{label}</span>
      {children}
    </div>
  );
}

/**
 * A missed trade's page (missed-trades spec §6.3), layout B: the day's chart on two thirds, its levels and review in
 * a column beside it, and the screenshots under both.
 */
export function MissedWorkspace({
  trade,
  onOpenTrade,
  onDeleted,
}: {
  trade: TradeDetailView;
  onOpenTrade?: (id: string) => void;
  onDeleted?: () => void;
}) {
  const stored = trade.missed as MissedLevels;
  const date = nyDate(trade.openedAt);
  const save = useSaveTrade(trade.id);
  const deletion = useDeleteMissed();
  const [live, setLive] = useState<Partial<MissedLevels>>({});
  const [placing, setPlacing] = useState<Placing>(() =>
    stored.stopPrice == null && Date.now() - trade.createdAt < JUST_CREATED_MS ? "stop" : null,
  );
  const [exitDraft, setExitDraft] = useState<{ time: string; price: string }>({ time: "", price: "" });
  const [refused, setRefused] = useState<{ field: string; message: string } | null>(null);
  // A dragged or clicked level shows where it went until the saved trade comes back with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stored levels arriving is the signal
  useEffect(() => setLive({}), [trade.missed]);
  // A new exit is typed from scratch: a half typed before the exit was set or cleared is stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stored exit changing is the signal
  useEffect(() => setExitDraft({ time: "", price: "" }), [trade.closedAt, stored.exitPrice]);
  useAutoFillPrices(trade);
  const rangeProblem = useRangeProblem(trade.id);

  const levels: MissedLevels = { ...stored, ...live };
  const risk = missedRisk(trade, live);
  /** Saves, and on a refusal puts the server's reason under the field that sent it, if one did. */
  const send = (body: TradePatchBody, field?: string) => {
    setRefused(null);
    save.mutate(body, {
      onError: (error) => {
        setLive({});
        if (field) setRefused({ field, message: error.message });
      },
    });
  };
  const refusedFor = (field: string) => (refused?.field === field ? refused.message : null);
  /** A point put on another of the chart's days: a missed trade keeps its date, so it's refused, under its time. */
  const offDay = (id: "entry" | "exit", t: number) => {
    if (nyDate(t) === date) return false;
    setRefused({
      field: id === "entry" ? "Entry time" : "Exit time",
      message: `Place it on ${dayText(date)}`,
    });
    return true;
  };
  /** A level placed, clicked or typed: placing goes on from the stop to an unmarked exit, as on a new trade. */
  const placed = (what: Exclude<Placing, null>) => {
    if (placing === what) setPlacing(what === "stop" && trade.closedAt == null ? "exit" : null);
  };

  // An exit not marked yet charts the entry's day to its close, not up to today.
  const chartTrade = useMemo(
    () => ({
      underlying: trade.underlying,
      openedAt: trade.openedAt,
      closedAt: trade.closedAt ?? nyWallClock(date, regularClose(date)),
      legs: [],
      fills: [],
    }),
    [trade.underlying, trade.openedAt, trade.closedAt, date],
  );
  const { from, lastDay } = barRange(chartTrade);
  const minute = useMinuteBars(trade.underlying, from, lastDay, false);
  const barAt = (t: number) =>
    minute.data?.bars.find((bar) => Math.floor(bar.t / 60_000) === Math.floor(t / 60_000));
  const day = useDayTrades(trade.underlying, date, trade.id);
  const context = useMemo(() => contextMarks(day), [day]);

  const lines: PriceLine[] = [];
  if (levels.stopPrice != null) {
    lines.push({ id: "stop", price: levels.stopPrice, color: STOP_COLOR, dashed: true, label: "Stop" });
  }
  if (levels.targetPrice != null) {
    lines.push({
      id: "target",
      price: levels.targetPrice,
      color: TARGET_COLOR,
      dashed: true,
      label: "Target",
    });
  }
  const points: PointMark[] = [
    { id: "entry", t: trade.openedAt, price: levels.entryPrice, label: `Entry ${price(levels.entryPrice)}` },
  ];
  if (trade.closedAt != null && levels.exitPrice != null) {
    points.push({
      id: "exit",
      t: trade.closedAt,
      price: levels.exitPrice,
      label: `Exit ${price(levels.exitPrice)}`,
    });
  }

  const editing: ChartEditing = {
    placing,
    onPlace(id, at) {
      if (id === "stop") {
        // A first stop says which way the trade went: under the entry is a long (spec §6.3).
        const first = stored.stopPrice == null;
        const direction: Direction = at < levels.entryPrice ? "long" : "short";
        setLive((now) => ({ ...now, stopPrice: at, ...(first ? { direction } : {}) }));
        send({ missed: { stopPrice: at, ...(first ? { direction } : {}) } });
        placed("stop");
      } else if (id === "target") {
        setLive((now) => ({ ...now, targetPrice: at }));
        send({ missed: { targetPrice: at } });
        placed("target");
      }
    },
    onDrag(id, at) {
      setLive((now) => ({ ...now, [id === "stop" ? "stopPrice" : "targetPrice"]: at }));
    },
    onDrop(id, at) {
      const key = id === "stop" ? "stopPrice" : "targetPrice";
      setLive((now) => ({ ...now, [key]: at }));
      send({ missed: { [key]: at } });
    },
    onCancel() {
      setPlacing(null);
      setLive({});
    },
    onPlacePoint(id, t, at) {
      if (offDay(id, t)) return;
      if (id === "exit") send({ closedAt: t, missed: { exitPrice: at } });
      setPlacing(null);
    },
    onDropPoint(id, t, at) {
      if (offDay(id, t)) return;
      if (id === "entry") send({ openedAt: t, missed: { entryPrice: at } });
      else send({ closedAt: t, missed: { exitPrice: at } });
    },
  };

  const FIELDS = { entryPrice: "Entry price", stopPrice: "Stop", targetPrice: "Target" } as const;
  const commitPrice = (key: keyof typeof FIELDS, text: string, clearable: boolean) => {
    if (clearable && text.trim() === "") {
      send({ missed: { [key]: null } }, FIELDS[key]);
      return null;
    }
    const parsed = parsePrice(text);
    if (typeof parsed === "string") return parsed;
    send({ missed: { [key]: parsed } }, FIELDS[key]);
    if (key === "stopPrice") placed("stop");
    if (key === "targetPrice") placed("target");
    return null;
  };
  const commitExit = (part: "time" | "price", text: string) => {
    const next = { ...exitDraft, [part]: text };
    setExitDraft(next);
    if (trade.closedAt != null && stored.exitPrice != null) {
      if (part === "time") {
        const t = parseClock(text, date);
        if (typeof t === "string") return t;
        send({ closedAt: t }, "Exit time");
      } else {
        const parsed = parsePrice(text);
        if (typeof parsed === "string") return parsed;
        send({ missed: { exitPrice: parsed } }, "Exit price");
      }
      return null;
    }
    // A new exit needs its time and price together.
    if (next.time.trim() === "" || next.price.trim() === "") return null;
    const t = parseClock(next.time, date);
    if (typeof t === "string") return t;
    const parsed = parsePrice(next.price);
    if (typeof parsed === "string") return parsed;
    send({ closedAt: t, missed: { exitPrice: parsed } }, part === "time" ? "Exit time" : "Exit price");
    placed("exit");
    return null;
  };
  const place = (what: Exclude<Placing, null>, name: string) => (
    <button
      type="button"
      onClick={() => setPlacing(what)}
      className={`${SMALL_BUTTON} ${placing === what ? "border-accent text-fg" : ""}`}
    >
      + {name}
    </button>
  );
  const remove = () => {
    if (!window.confirm("Delete this missed trade?")) return;
    deletion.mutate(trade.id, { onSuccess: () => onDeleted?.() });
  };

  const excursions = excursionLine(risk);
  const r = risk?.r ?? null;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="num font-semibold text-[16px]">{trade.underlying}</h1>
        <span className="text-muted">{trade.underlyingName}</span>
        <Chip tone="missed">MISSED</Chip>
        <span
          className={`rounded-[2px] px-1.5 py-px text-[10px] ${
            levels.direction === "long" ? "bg-[#26a69a22] text-up" : "bg-[#ef535022] text-down"
          }`}
        >
          {levels.direction === "long" ? "Long" : "Short"}
        </span>
        {trade.excluded && <Chip tone="excluded">EXCLUDED</Chip>}
        <span className="num text-muted">
          {new Date(trade.openedAt).toLocaleDateString("en-US", {
            timeZone: "America/New_York",
            month: "short",
            day: "numeric",
          })}
          , {clockText(trade.openedAt)}
          {trade.closedAt != null ? ` → ${clockText(trade.closedAt)}` : ""}
        </span>
        <span
          data-testid="header-r"
          className={`num ml-auto text-[18px] ${r == null ? "text-muted" : r > 0 ? "text-up" : r < 0 ? "text-down" : ""}`}
        >
          {r == null ? "—" : rText(r)}
        </span>
        <button
          type="button"
          onClick={remove}
          className="rounded-sm border border-line bg-panel px-3 py-1 text-muted hover:border-down hover:text-down"
        >
          Delete
        </button>
      </header>
      <div className="grid items-start gap-3 lg:grid-cols-[2fr_1fr]">
        <TradeCharts
          trade={chartTrade}
          daily={false}
          levels={{ lines, editing }}
          points={points}
          context={context}
          onOpenTrade={onOpenTrade}
          showDay
        />
        <Panel title="Missed trade">
          <div className="flex flex-col gap-1.5">
            <Row label="Direction">
              {(["long", "short"] as const).map((each) => (
                <button
                  key={each}
                  type="button"
                  aria-pressed={levels.direction === each}
                  onClick={() => {
                    if (levels.direction !== each) send({ missed: { direction: each } });
                  }}
                  className={`rounded-[2px] border px-2 py-0.5 ${
                    levels.direction === each
                      ? "border-accent bg-accent text-white"
                      : "border-line text-muted"
                  }`}
                >
                  {each === "long" ? "Long" : "Short"}
                </button>
              ))}
            </Row>
            <Row label="Entry">
              <Field
                label="Entry time"
                value={clockText(trade.openedAt)}
                onCommit={(text) => {
                  const t = parseClock(text, date);
                  if (typeof t === "string") return t;
                  send({ openedAt: t }, "Entry time");
                  return null;
                }}
                refused={refusedFor("Entry time")}
              />
              <Field
                label="Entry price"
                value={price(levels.entryPrice)}
                onCommit={(text) => commitPrice("entryPrice", text, false)}
                refused={refusedFor("Entry price")}
                warning={rangeWarning(levels.entryPrice, barAt(trade.openedAt) ?? null)}
              />
            </Row>
            <Row label="Stop" labelClass="text-down">
              {levels.stopPrice == null && placing !== "stop" ? (
                place("stop", "Stop")
              ) : (
                <>
                  <Field
                    label="Stop"
                    value={price(levels.stopPrice)}
                    onCommit={(text) => commitPrice("stopPrice", text, true)}
                    refused={refusedFor("Stop")}
                  />
                  {levels.stopPrice != null && (
                    <button
                      type="button"
                      aria-label="Clear the stop"
                      onClick={() => send({ missed: { stopPrice: null } })}
                      className={SMALL_BUTTON}
                    >
                      ×
                    </button>
                  )}
                </>
              )}
            </Row>
            <Row label="Target" labelClass="text-up">
              {levels.targetPrice == null && placing !== "target" ? (
                place("target", "Target")
              ) : (
                <>
                  <Field
                    label="Target"
                    value={price(levels.targetPrice)}
                    onCommit={(text) => commitPrice("targetPrice", text, true)}
                    refused={refusedFor("Target")}
                  />
                  {levels.targetPrice != null && (
                    <button
                      type="button"
                      aria-label="Clear the target"
                      onClick={() => send({ missed: { targetPrice: null } })}
                      className={SMALL_BUTTON}
                    >
                      ×
                    </button>
                  )}
                </>
              )}
            </Row>
            <Row label="Exit">
              <Field
                label="Exit time"
                value={trade.closedAt != null && stored.exitPrice != null ? clockText(trade.closedAt) : ""}
                onCommit={(text) => commitExit("time", text)}
                refused={refusedFor("Exit time")}
              />
              <Field
                label="Exit price"
                value={price(levels.exitPrice)}
                onCommit={(text) => commitExit("price", text)}
                refused={refusedFor("Exit price")}
                warning={
                  trade.closedAt != null && levels.exitPrice != null
                    ? rangeWarning(levels.exitPrice, barAt(trade.closedAt) ?? null)
                    : null
                }
              />
              {trade.closedAt != null && stored.exitPrice != null ? (
                <button
                  type="button"
                  aria-label="Clear the exit"
                  onClick={() => send({ closedAt: null, missed: { exitPrice: null } })}
                  className={SMALL_BUTTON}
                >
                  ×
                </button>
              ) : (
                placing !== "exit" && place("exit", "Exit")
              )}
            </Row>
            <div className="num mt-1 border-line border-t pt-1.5 text-fg">
              <div>{missedLine(risk, levels.direction)}</div>
              {excursions ? (
                <div>{excursions}</div>
              ) : (
                trade.closedAt != null &&
                rangeProblem && <div className="text-[10px] text-muted">{rangeProblem}</div>
              )}
            </div>
            <div className="mt-1 flex flex-col gap-1.5 border-line border-t pt-1.5">
              <Row label="Setup">
                <SetupPicker trade={trade} onPick={(setupId) => send({ setupId })} />
              </Row>
              <Row label="Grade">
                {GRADES.map((each) => (
                  <button
                    key={each}
                    type="button"
                    aria-pressed={trade.grade === each}
                    onClick={() => send({ grade: trade.grade === each ? null : each })}
                    className={`num w-6 rounded-[2px] border py-0.5 ${
                      trade.grade === each ? "border-accent bg-accent text-white" : "border-line text-muted"
                    }`}
                  >
                    {each}
                  </button>
                ))}
              </Row>
              <Row label="Skipped">
                <TagChips trade={trade} kind="skip" onPick={(tagIds) => send({ tagIds })} />
              </Row>
              <Row label="Emotion">
                <TagChips trade={trade} kind="emotion" onPick={(tagIds) => send({ tagIds })} />
              </Row>
              <textarea
                key={trade.id}
                aria-label="Notes"
                placeholder="Notes…"
                defaultValue={trade.notes ?? ""}
                onBlur={(event) => {
                  if (event.target.value !== (trade.notes ?? "")) send({ notes: event.target.value });
                }}
                className="min-h-14 w-full rounded-sm border border-line bg-[#0e1118] p-2 text-fg outline-none focus:border-accent"
              />
              <label className="flex items-center gap-2 text-muted">
                <input
                  type="checkbox"
                  checked={trade.excluded}
                  onChange={(event) => send({ excluded: event.target.checked })}
                />
                Exclude from stats
              </label>
            </div>
            {save.error && !refused && <p className="text-down">Couldn't save: {save.error.message}</p>}
            {deletion.error && <p className="text-down">Couldn't delete: {deletion.error.message}</p>}
          </div>
        </Panel>
      </div>
      <Screenshots trade={{ id: trade.id, attachments: trade.attachments ?? [] }} />
    </div>
  );
}
