import type { OquantsPayload, OquantsTradeCells } from "./payload.js";

/**
 * Synthetic oQuants payloads, shaped like the real table. Real captures hold
 * the user's trades and never enter the repo.
 */
export const OQUANTS_HEADERS = [
  "Instrument",
  "Strategy",
  "Structure",
  "Notes",
  "Open Date",
  "Close Date",
  "Type",
  "Expiry",
  "Strike",
  "Size",
  "Cost",
  "P&L",
  "P&L %",
  "Actions",
];

export interface FixtureLeg {
  type: "Call" | "Put";
  strike: number;
  /** Signed: negative is short. */
  size: number;
  cost: string;
  pnl: string;
}

/** Short 50 straddle, wings 45 / 58, 4 lots: $1,200 credit, +$520 before $8 of fees. */
export const FLY_LEGS: FixtureLeg[] = [
  { type: "Call", strike: 50, size: -4, cost: "-840.00", pnl: "+440.00" },
  { type: "Put", strike: 50, size: -4, cost: "-640.00", pnl: "+320.00" },
  { type: "Call", strike: 58, size: 4, cost: "+140.00", pnl: "-120.00" },
  { type: "Put", strike: 45, size: 4, cost: "+140.00", pnl: "-120.00" },
];

export interface FixtureTradeOptions {
  ticker?: string;
  strategy?: string;
  structure?: string;
  notes?: string;
  open?: string;
  close?: string;
  cost?: string;
  pnl?: string;
  expiry?: string;
  legs?: FixtureLeg[];
}

export function fixtureTrade(options: FixtureTradeOptions = {}): OquantsTradeCells {
  const ticker = options.ticker ?? "XYZ";
  const legs = options.legs ?? FLY_LEGS;
  const params = new URLSearchParams();
  legs.forEach((leg, index) => {
    params.set(`positions[${index}][buySell]`, leg.size < 0 ? "S" : "B");
    params.set(`positions[${index}][size]`, String(Math.abs(leg.size)));
    params.set(`positions[${index}][type]`, leg.type);
    params.set(`positions[${index}][strike]`, String(leg.strike));
    params.set(`positions[${index}][expiration]`, options.expiry ?? "2026-09-11");
  });
  const row: Record<string, string> = {
    Instrument: `${ticker}\n48.10\nExample Corp`,
    Strategy: options.strategy ?? "Earnings",
    Structure: options.structure ?? "Short Iron Butterfly",
    Notes: options.notes ?? "filled at mid",
    "Open Date": options.open ?? "Sep 9, 8:54 PM",
    "Close Date": options.close ?? "Sep 10, 8:44 PM\n(1d)",
    Cost: options.cost ?? "-1,192.00",
    "P&L": options.pnl ?? "+512.00",
    "P&L %": "+42.95%",
  };
  return {
    ticker,
    cells: OQUANTS_HEADERS.map((header) => row[header] ?? ""),
    designerHref: `/dashboard/designer/${ticker}?${params}`,
    legs: legs.map((leg) => {
      const legRow: Record<string, string> = {
        Type: leg.type,
        Expiry: "Sep 11\n(2d)",
        Strike: leg.strike.toFixed(2),
        Size: leg.size > 0 ? `+${leg.size}` : String(leg.size),
        Cost: leg.cost,
        "P&L": leg.pnl,
      };
      return { cells: OQUANTS_HEADERS.map((header) => legRow[header] ?? "") };
    }),
  };
}

export function fixturePayload(
  trades: OquantsTradeCells[] = [fixtureTrade()],
  extra: Partial<OquantsPayload> = {},
): OquantsPayload {
  return {
    format: "oquants-cells/1",
    capturedAt: "2026-09-23T15:00:00.000Z",
    timeZone: "Europe/Athens",
    pageCounter: `1–${trades.length} of ${trades.length}`,
    headers: OQUANTS_HEADERS,
    trades,
    ...extra,
  };
}
