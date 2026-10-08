import {
  ironFlyStructureFromLegs,
  type LegInput,
  type NewTrade,
  type PricedLeg,
  positionCash,
  round2,
} from "@tj/core";
import { uuidV5 } from "../oquants/ids.js";
import type { FillKind, OpenClose } from "./parse.js";

/** Fixed namespace for IBKR ids; changing it would make every synced trade new. */
export const IBKR_NAMESPACE = "7c1f2b9a-4e3d-4c8b-9a6f-2d5e8b1c3f40";

export const fillIdFor = (account: string, key: string) => uuidV5(`ibkr:${account}:${key}`, IBKR_NAMESPACE);
export const tradeIdFor = (account: string, firstOpeningKey: string) =>
  uuidV5(`ibkr:${account}:${firstOpeningKey}`, IBKR_NAMESPACE);
export const legIdFor = (tradeId: string, conid: string) => uuidV5(`${tradeId}:${conid}`, IBKR_NAMESPACE);
export const accountIdFor = (accountId: string) => uuidV5(`ibkr-account:${accountId}`, IBKR_NAMESPACE);

/** A stored fill, as grouping needs it. */
export interface FillForGrouping {
  id: string;
  key: string;
  conid: string;
  underlying: string;
  right: "C" | "P";
  strike: number;
  expiry: string;
  multiplier: number;
  executedAt: number;
  quantity: number;
  price: number;
  commission: number;
  openClose: OpenClose | null;
  kind: FillKind;
}

export interface TradeCandidate {
  id: string;
  trade: NewTrade;
  /** Parallel to `trade.legs`. */
  legIds: string[];
  fillIds: string[];
}

export interface SkippedEpisode {
  reason: "before_start" | "unrecognised";
  ticker: string;
  openedAt: number;
  fillIds: string[];
}

export interface Grouped {
  candidates: TradeCandidate[];
  skipped: SkippedEpisode[];
  links: Map<string, { tradeId: string; legId: string }>;
}

interface GroupOptions {
  account: string;
  book: "live" | "paper";
}

const byTime = (a: FillForGrouping, b: FillForGrouping) =>
  a.executedAt - b.executedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
/** Size-weighted average price, to 6 decimals, so an edit form shows 1.49 rather than 1.4899999999999998. */
const averagePrice = (fills: FillForGrouping[]) =>
  Math.round(
    (sum(fills.map((fill) => Math.abs(fill.quantity) * fill.price)) /
      sum(fills.map((fill) => Math.abs(fill.quantity)))) *
      1e6,
  ) / 1e6;

function byContract(fills: FillForGrouping[]): FillForGrouping[][] {
  const contracts = new Map<string, FillForGrouping[]>();
  for (const fill of fills) {
    const list = contracts.get(fill.conid);
    if (list) list.push(fill);
    else contracts.set(fill.conid, [fill]);
  }
  return [...contracts.values()];
}

/** Whether IBKR says a fill closes a position, all or part of it. */
const closes = (fill: FillForGrouping) => fill.openClose === "C" || fill.openClose === "C;O";

/**
 * A fill that takes a contract through zero, such as selling 2 against a long 1, closes the position and opens a
 * new one with the rest, so it's split at zero: the trade it closed goes flat there. The closing part keeps the
 * fill's id, so the fill shows on that trade; the opening part gets its own id and key, and its share of the
 * commission. Returns each opening part's id with its fill's.
 *
 * The position is counted from the window's first fill, so a split needs IBKR's word too: only a fill marked
 * "C;O", or one with no mark, is split. Fills in the same second sort by key, not by when they happened, so a
 * count can cross zero where the account never did; and a contract whose first fill closes was held from before
 * the window, so its count is off by what was held.
 */
function splitCrossings(fills: FillForGrouping[]): { fills: FillForGrouping[]; parts: Map<string, string> } {
  const position = new Map<string, number>();
  const heldBefore = new Set<string>();
  const out: FillForGrouping[] = [];
  const parts = new Map<string, string>();
  for (const fill of fills) {
    if (!position.has(fill.conid) && closes(fill)) heldBefore.add(fill.conid);
    const before = position.get(fill.conid) ?? 0;
    const after = before + fill.quantity;
    position.set(fill.conid, after);
    const marked = fill.openClose === "C;O" || fill.openClose === null;
    if (before * after >= 0 || !marked || heldBefore.has(fill.conid)) {
      out.push(fill);
      continue;
    }
    const closing = Math.round(((fill.commission * Math.abs(before)) / Math.abs(fill.quantity)) * 1e6) / 1e6;
    const opening = { id: `${fill.id}:open`, key: `${fill.key}:open` };
    out.push(
      { ...fill, quantity: -before, commission: closing, openClose: "C" },
      {
        ...fill,
        ...opening,
        quantity: after,
        commission: Math.round((fill.commission - closing) * 1e6) / 1e6,
        openClose: "O",
      },
    );
    parts.set(opening.id, fill.id);
  }
  return { fills: out, parts };
}

/** One contract's fills split flat to flat. */
function roundTrips(fills: FillForGrouping[]): FillForGrouping[][] {
  const trips: FillForGrouping[][] = [];
  let trip: FillForGrouping[] = [];
  let position = 0;
  for (const fill of fills) {
    trip.push(fill);
    position += fill.quantity;
    if (position === 0) {
      trips.push(trip);
      trip = [];
    }
  }
  if (trip.length > 0) trips.push(trip);
  return trips;
}

/**
 * IBKR's fills regrouped into trades by position episode (spec §7): per ticker and expiry, flat to flat.
 * An episode that only bought is scalps, one per contract round trip; one that opened by selling calls and
 * puts is an iron fly; anything else is skipped with its reason.
 */
export function groupFills(fills: readonly FillForGrouping[], options: GroupOptions): Grouped {
  const out: Grouped = { candidates: [], skipped: [], links: new Map() };
  const buckets = new Map<string, FillForGrouping[]>();
  const split = splitCrossings([...fills].sort(byTime));
  for (const fill of split.fills) {
    const key = `${fill.underlying}|${fill.expiry}`;
    const list = buckets.get(key);
    if (list) list.push(fill);
    else buckets.set(key, [fill]);
  }
  for (const bucket of buckets.values()) {
    const open: Episode[] = [];
    for (const fill of bucket) {
      let episode = episodeFor(open, fill);
      if (!episode) {
        episode = { fills: [], position: new Map(), sold: false };
        open.push(episode);
      }
      episode.fills.push(fill);
      const quantity = (episode.position.get(fill.conid) ?? 0) + fill.quantity;
      episode.position.set(fill.conid, quantity);
      if (quantity < 0) episode.sold = true;
      if ([...episode.position.values()].every((each) => each === 0)) {
        settle(episode.fills, out, options);
        open.splice(open.indexOf(episode), 1);
      }
    }
    for (const episode of open) settle(episode.fills, out, options);
  }
  // An opening part is no stored fill. The fill links to the trade its closing part closed, or, when that part was
  // skipped, to the trade its opening part began.
  for (const [id, fillId] of split.parts) {
    const link = out.links.get(id);
    out.links.delete(id);
    if (link && !out.links.has(fillId)) out.links.set(fillId, link);
  }
  out.candidates.sort((a, b) => a.trade.openedAt - b.trade.openedAt);
  return out;
}

/** A position being tracked from flat to flat. `sold`: some contract in it went short. */
interface Episode {
  fills: FillForGrouping[];
  position: Map<string, number>;
  sold: boolean;
}

/**
 * The episode a fill belongs to: the one holding its contract, else the one still being built. A fly whose short
 * legs have all been bought back is only waiting for its wings to expire, so it takes no new contracts: a scalp in
 * the same expiry that morning is a trade of its own.
 */
function episodeFor(open: Episode[], fill: FillForGrouping): Episode | undefined {
  const holding = open.find((episode) => (episode.position.get(fill.conid) ?? 0) !== 0);
  if (holding) return holding;
  const windingDown = (episode: Episode) =>
    episode.sold && [...episode.position.values()].every((quantity) => quantity >= 0);
  return open.find((episode) => !windingDown(episode));
}

function settle(episode: FillForGrouping[], out: Grouped, options: GroupOptions): void {
  const skip = (reason: SkippedEpisode["reason"], fills = episode): void => {
    out.skipped.push({
      reason,
      ticker: fills[0]?.underlying ?? "",
      openedAt: fills[0]?.executedAt ?? 0,
      fillIds: fills.map((fill) => fill.id),
    });
  };
  const contracts = byContract(episode);
  // A contract whose first fill closes a position was opened before the fills we have.
  if (contracts.some((fills) => fills[0] && closes(fills[0]))) {
    skip("before_start");
    return;
  }

  const openedBySelling = contracts.some((fills) => (fills[0]?.quantity ?? 0) < 0);
  if (!openedBySelling) {
    // A round trip opened by selling, after the contract went flat or through zero, is a short: not a scalp.
    for (const fills of contracts)
      for (const trip of roundTrips(fills)) {
        if ((trip[0]?.quantity ?? 0) < 0) skip("unrecognised", trip);
        else addTrade([trip], "scalp", out, options);
      }
    return;
  }
  const opened = (right: "C" | "P", short: boolean) =>
    contracts.filter((fills) => fills[0]?.right === right && (fills[0]?.quantity ?? 0) < 0 === short).length;
  // A leg that went from short to long, or back, is two positions: no one leg of a fly.
  const changesSide = contracts.some((fills) =>
    roundTrips(fills).some(
      (trip) => Math.sign(trip[0]?.quantity ?? 0) !== Math.sign(fills[0]?.quantity ?? 0),
    ),
  );
  const isFly =
    !changesSide &&
    opened("C", true) === 1 &&
    opened("P", true) === 1 &&
    opened("C", false) <= 1 &&
    opened("P", false) <= 1 &&
    opened("C", false) + opened("P", false) >= 1;
  if (!isFly) {
    skip("unrecognised");
    return;
  }
  addTrade(contracts, "iron_fly", out, options);
}

function addTrade(
  legFills: FillForGrouping[][],
  strategy: "scalp" | "iron_fly",
  out: Grouped,
  options: GroupOptions,
): void {
  const all = legFills.flat().sort(byTime);
  const openingIds = new Set<string>();
  for (const fills of legFills) {
    const sign = Math.sign(fills[0]?.quantity ?? 0);
    for (const fill of fills) if (Math.sign(fill.quantity) === sign) openingIds.add(fill.id);
  }
  const firstOpening = all.find((fill) => openingIds.has(fill.id)) ?? all[0];
  if (!firstOpening) return;
  const tradeId = tradeIdFor(options.account, firstOpening.key);

  const legs: LegInput[] = [];
  const legIds: string[] = [];
  let feesOpen = 0;
  let feesClose = 0;
  let flat = true;
  for (const fills of legFills) {
    const first = fills[0];
    if (!first) continue;
    const opening = fills.filter((fill) => openingIds.has(fill.id));
    const closing = fills.filter((fill) => !openingIds.has(fill.id));
    const legFlat = sum(fills.map((fill) => fill.quantity)) === 0;
    if (!legFlat) flat = false;
    feesOpen += sum(opening.map((fill) => fill.commission));
    feesClose += sum(closing.map((fill) => fill.commission));
    legs.push({
      right: first.right,
      strike: first.strike,
      expiry: first.expiry,
      quantity: sum(opening.map((fill) => fill.quantity)),
      multiplier: first.multiplier,
      openPrice: averagePrice(opening),
      closePrice: legFlat && closing.length > 0 ? averagePrice(closing) : null,
    });
    const legId = legIdFor(tradeId, first.conid);
    legIds.push(legId);
    for (const fill of fills) out.links.set(fill.id, { tradeId, legId });
  }

  const priced: PricedLeg[] = legs.map((leg) => ({
    right: leg.right,
    strike: leg.strike,
    quantity: leg.quantity,
    multiplier: leg.multiplier,
    openPrice: leg.openPrice,
    closePrice: leg.closePrice,
  }));
  // From the rounded parts, as the forms add them: re-saving an unchanged trade must not move its fees by a cent.
  const cash = positionCash(priced, { open: round2(feesOpen), close: round2(feesClose) });
  // Untouched wings expire at 16:20; the trade was closed when its last exchange fill closed it.
  const closings = all.filter((fill) => !openingIds.has(fill.id));
  const lastExchangeClose = closings.filter((fill) => fill.kind === "trade").at(-1);
  const closedAt = flat ? ((lastExchangeClose ?? closings.at(-1) ?? all.at(-1))?.executedAt ?? null) : null;
  const structure = strategy === "iron_fly" ? ironFlyStructureFromLegs(priced) : null;

  const trade: NewTrade = {
    strategy,
    book: options.book,
    underlying: firstOpening.underlying,
    underlyingName: null,
    structureLabel:
      strategy === "iron_fly"
        ? "Short Iron Butterfly"
        : firstOpening.right === "C"
          ? "Long call"
          : "Long put",
    openedAt: all[0]?.executedAt ?? firstOpening.executedAt,
    closedAt,
    netPnl: cash.netPnl,
    fees: cash.fees,
    feesOpen: round2(feesOpen),
    feesClose: round2(feesClose),
    notes: null,
    grade: null,
    excluded: false,
    excludeReason: null,
    source: "ibkr_flex",
    setupId: null,
    tagIds: [],
    legs,
    missed: null,
    ironFly: structure
      ? {
          ...structure,
          contracts: cash.contracts,
          creditPerShare: -(cash.netCost - cash.fees) / cash.shares,
          netCost: cash.netCost,
          earningsDate: null,
          earningsTiming: null,
          impliedMovePct: null,
          actualMovePct: null,
          ivBefore: null,
          ivAfter: null,
          sourceNotes: null,
        }
      : null,
  };
  out.candidates.push({ id: tradeId, trade, legIds, fillIds: all.map((fill) => fill.id) });
}
