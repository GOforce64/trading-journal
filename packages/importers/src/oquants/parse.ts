import { type LegInput, type NewTrade, newTradeSchema, round2, sumMoney } from "@tj/core";
import { OQUANTS_NAMESPACE, uuidV5 } from "./ids.js";
import { OquantsFormatError, type OquantsPayload, type OquantsTradeCells } from "./payload.js";
import { type MonthDayTime, parseOquantsDate, zonedTimeToEpoch } from "./time.js";

const REQUIRED = [
  "Instrument",
  "Strategy",
  "Structure",
  "Notes",
  "Open Date",
  "Close Date",
  "Type",
  "Strike",
  "Size",
  "Cost",
  "P&L",
] as const;
type Column = (typeof REQUIRED)[number];
type CellReader = (cells: string[], column: Column) => string;

export interface ParsedTrade {
  kind: "trade";
  id: string;
  trade: NewTrade;
  flags: string[];
}

export interface SkippedRow {
  kind: "skip";
  ticker: string;
  structure: string;
  reason: string;
}

export type OquantsRow = ParsedTrade | SkippedRow;

export interface OquantsParseResult {
  rows: OquantsRow[];
  warnings: string[];
}

/** One trade can't be imported; caught per row so it never sinks the rest. */
class Skip extends Error {}

interface RawLeg {
  right: "C" | "P";
  strike: number;
  /** Signed: negative is short. */
  quantity: number;
  expiry: string;
  cost: number;
  /** Null when oQuants shows no P&L for the leg. */
  pnl: number | null;
}

interface Structure {
  bodyPutStrike: number;
  bodyCallStrike: number;
  putWingStrike: number;
  /** Null when there is no long call. */
  callWingStrike: number | null;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function money(text: string): number {
  const cleaned = text.replace(/[\s,$+]/g, "");
  const value = Number(cleaned);
  if (cleaned === "" || Number.isNaN(value)) throw new Skip(`unparseable number "${text}"`);
  return value;
}

/** The designer link is the only place oQuants gives each leg's full ISO expiry. */
function linkLegs(href: string): { right: "C" | "P"; strike: number; expiry: string }[] {
  const params = new URL(href, "https://oquants.invalid").searchParams;
  const legs: { right: "C" | "P"; strike: number; expiry: string }[] = [];
  for (let index = 0; params.has(`positions[${index}][type]`); index++) {
    const expiry = params.get(`positions[${index}][expiration]`) ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) continue;
    legs.push({
      right: params.get(`positions[${index}][type]`) === "Call" ? "C" : "P",
      strike: Number(params.get(`positions[${index}][strike]`)),
      expiry,
    });
  }
  return legs;
}

function readLegs(raw: OquantsTradeCells, cell: CellReader): RawLeg[] {
  const fromLink = linkLegs(raw.designerHref);
  return raw.legs.map((leg) => {
    const type = cell(leg.cells, "Type");
    if (type !== "Call" && type !== "Put") throw new Skip("unrecognized structure");
    const right = type === "Call" ? "C" : "P";
    const strike = money(cell(leg.cells, "Strike"));
    // A closed leg can read "0 / -4" (current / original); the original is what was traded.
    const quantity = money(cell(leg.cells, "Size").split("/").at(-1) ?? "");
    if (!Number.isInteger(quantity) || quantity === 0) throw new Skip("unrecognized structure");
    const expiry = fromLink.find(
      (link) => link.right === right && Math.abs(link.strike - strike) < 1e-6,
    )?.expiry;
    if (!expiry) throw new Skip(`leg ${type} ${strike} is missing from the designer link`);
    const pnlText = cell(leg.cells, "P&L");
    return {
      right,
      strike,
      quantity,
      expiry,
      cost: money(cell(leg.cells, "Cost")),
      pnl: pnlText === "" ? null : money(pnlText),
    };
  });
}

/** A short put and call body, with a long call above and/or a long put below. */
function classify(legs: RawLeg[]): Structure {
  const pick = (right: "C" | "P", short: boolean) =>
    legs.filter((leg) => leg.right === right && leg.quantity < 0 === short);
  const shortCalls = pick("C", true);
  const shortPuts = pick("P", true);
  const longCalls = pick("C", false);
  const longPuts = pick("P", false);
  const [shortCall] = shortCalls;
  const [shortPut] = shortPuts;
  const [longCall] = longCalls;
  const [longPut] = longPuts;
  if (!shortCall || !shortPut || shortCalls.length > 1 || shortPuts.length > 1) {
    throw new Skip("unrecognized structure");
  }
  if (longCalls.length > 1 || longPuts.length > 1) throw new Skip("unrecognized structure");
  if (!longCall && !longPut) throw new Skip("no wings — enter manually");
  const size = Math.abs(shortCall.quantity);
  if (legs.some((leg) => Math.abs(leg.quantity) !== size)) throw new Skip("unrecognized structure");
  if (
    (longCall && longCall.strike <= shortCall.strike) ||
    shortPut.strike > shortCall.strike ||
    (longPut && longPut.strike >= shortPut.strike)
  ) {
    throw new Skip("unrecognized structure");
  }
  return {
    bodyPutStrike: shortPut.strike,
    bodyCallStrike: shortCall.strike,
    putWingStrike: longPut?.strike ?? 0,
    callWingStrike: longCall?.strike ?? null,
  };
}

const dayNumber = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day);

/** oQuants dates carry no year: take the expiry's, stepping back if the open would land after expiry. */
function datesFor(open: MonthDayTime, close: MonthDayTime | null, expiry: string, timeZone: string) {
  const expiryYear = Number(expiry.slice(0, 4));
  const expiryDay = dayNumber(expiryYear, Number(expiry.slice(5, 7)), Number(expiry.slice(8, 10)));
  const openYear = dayNumber(expiryYear, open.month, open.day) > expiryDay ? expiryYear - 1 : expiryYear;
  const openedAt = zonedTimeToEpoch(openYear, open, timeZone);
  if (!close) return { openedAt, closedAt: null };
  const closeYear =
    dayNumber(openYear, close.month, close.day) < dayNumber(openYear, open.month, open.day)
      ? openYear + 1
      : openYear;
  return { openedAt, closedAt: zonedTimeToEpoch(closeYear, close, timeZone) };
}

function readDate(text: string): MonthDayTime {
  const date = parseOquantsDate(text);
  if (!date) throw new Skip(`unparseable date "${text}"`);
  return date;
}

/** "M\n22.68\nMacy's Inc": the company name is the line that is neither the ticker nor a price. */
function companyName(instrument: string, ticker: string): string | null {
  const lines = instrument
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) => line !== "" && line !== ticker && !/^[\d.,]+$/.test(line) && !line.startsWith(`${ticker} `),
    );
  return lines.at(-1) ?? null;
}

function parseTrade(raw: OquantsTradeCells, cell: CellReader, timeZone: string): ParsedTrade {
  const strategy = cell(raw.cells, "Strategy");
  if (strategy !== "Earnings") throw new Skip(`strategy ${strategy || "(none)"}`);

  if (raw.legs.length === 0)
    throw new Skip("no legs collected — the row did not expand; run the snippet again");
  const legs = readLegs(raw, cell);
  const structure = classify(legs);
  const flags: string[] = [];
  if (structure.putWingStrike === 0) flags.push("1 wing");
  if (structure.callWingStrike === null) flags.push("no call wing");

  const open = readDate(cell(raw.cells, "Open Date"));
  const closeText = cell(raw.cells, "Close Date");
  const close = closeText === "" ? null : readDate(closeText);
  const { openedAt, closedAt } = datesFor(open, close, legs[0]?.expiry ?? "", timeZone);

  const rowCost = money(cell(raw.cells, "Cost"));
  const legCost = sumMoney(legs.map((leg) => leg.cost));
  // Round-trip fees make the row's credit smaller than the legs' total.
  const fees = round2(rowCost - legCost);
  if (fees < 0) throw new Skip(`fees came out negative ($${fees.toFixed(2)})`);

  const closed = closedAt !== null;
  let netPnl: number | null = null;
  if (closed) {
    if (legs.some((leg) => leg.pnl === null)) throw new Skip("missing leg P&L");
    netPnl = money(cell(raw.cells, "P&L"));
    const gap = round2(sumMoney(legs.map((leg) => leg.pnl ?? 0)) - netPnl - fees);
    if (Math.abs(gap) > 0.01) flags.push(`doesn't reconcile ($${gap.toFixed(2)})`);
  }

  const contracts = Math.abs(legs[0]?.quantity ?? 0);
  const perShare = (dollars: number, quantity: number) =>
    round4(Math.abs(dollars) / (Math.abs(quantity) * 100));
  const legInputs: LegInput[] = legs.map((leg) => ({
    right: leg.right,
    strike: leg.strike,
    expiry: leg.expiry,
    quantity: leg.quantity,
    multiplier: 100,
    openPrice: perShare(leg.cost, leg.quantity),
    closePrice: closed ? perShare(leg.cost + (leg.pnl ?? 0), leg.quantity) : null,
  }));

  const ticker = (raw.ticker || cell(raw.cells, "Instrument").split("\n")[0] || "").trim();
  const result = newTradeSchema.safeParse({
    strategy: "iron_fly",
    book: "paper",
    source: "oquants_extract",
    underlying: ticker,
    underlyingName: companyName(cell(raw.cells, "Instrument"), ticker),
    structureLabel: cell(raw.cells, "Structure").slice(0, 60) || null,
    openedAt,
    closedAt,
    netPnl,
    fees,
    feesOpen: null,
    feesClose: null,
    legs: legInputs,
    ironFly: {
      ...structure,
      contracts,
      creditPerShare: round4(-legCost / (contracts * 100)),
      netCost: rowCost,
      sourceNotes: cell(raw.cells, "Notes") || null,
    },
  });
  if (!result.success) throw new Skip(`invalid trade: ${result.error.issues[0]?.message ?? "unknown"}`);

  // Close time is left out so an open trade keeps its id once it closes.
  const legKey = [...legInputs]
    .sort((a, b) => a.right.localeCompare(b.right) || a.strike - b.strike || a.quantity - b.quantity)
    .map((leg) => `${leg.right}${leg.strike}x${leg.quantity}`)
    .join(",");
  const key = `${ticker.toUpperCase()}|${Math.floor(openedAt / 60_000)}|${legKey}`;
  return { kind: "trade", id: uuidV5(key, OQUANTS_NAMESPACE), trade: result.data, flags };
}

function counterWarnings(payload: OquantsPayload): string[] {
  const total = /of\s+(\d+)/.exec(payload.pageCounter)?.[1];
  if (total === undefined || Number(total) === payload.trades.length) return [];
  return [
    `Collected ${payload.trades.length} trades, the page counter said ${total}. Some rows may be missing.`,
  ];
}

export function parseOquants(payload: OquantsPayload): OquantsParseResult {
  const columns = {} as Record<Column, number>;
  for (const name of REQUIRED) {
    const index = payload.headers.indexOf(name);
    if (index === -1) {
      throw new OquantsFormatError(
        `oQuants changed its table: the "${name}" column is missing, so the parser needs updating`,
      );
    }
    columns[name] = index;
  }
  const cell: CellReader = (cells, column) => (cells[columns[column]] ?? "").trim();

  const rows: OquantsRow[] = [];
  const seen = new Set<string>();
  for (const raw of payload.trades) {
    try {
      const row = parseTrade(raw, cell, payload.timeZone);
      if (seen.has(row.id)) throw new Skip("duplicate row");
      seen.add(row.id);
      rows.push(row);
    } catch (error) {
      if (!(error instanceof Skip)) throw error;
      rows.push({
        kind: "skip",
        ticker: raw.ticker,
        structure: cell(raw.cells, "Structure"),
        reason: error.message,
      });
    }
  }
  return { rows, warnings: counterWarnings(payload) };
}
