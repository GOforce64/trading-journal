import {
  contractsHeld,
  type NewTrade,
  round2,
  sessionMoment,
  sortTargets,
  type TargetLevel,
  type TradePatch,
  trimProblem,
} from "@tj/core";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  ironFlyDetails,
  legs,
  scalpDetails,
  scalpPrices,
  scalpTargets,
  tags,
  trades,
  tradeTags,
} from "../schema.js";

export type TradeRow = typeof trades.$inferSelect;
export type LegRow = typeof legs.$inferSelect;
export type IronFlyRow = typeof ironFlyDetails.$inferSelect;
export type ScalpRow = typeof scalpDetails.$inferSelect;
export type ScalpPricesRow = typeof scalpPrices.$inferSelect;
/** A scalp's levels: its basis, stop and overrides, and its targets in the order the trade reaches them. */
export type ScalpLevels = ScalpRow & { targets: TargetLevel[] };

export interface TradeRecord extends TradeRow {
  legs: LegRow[];
  ironFly: IronFlyRow | null;
  /** The scalp's levels (scalp-review spec §5, scalp-R spec §5); null until the first is set. */
  scalp: ScalpLevels | null;
  /** The stock prices the filler fetched for a scalp (scalp-R spec §5); null until it has. */
  scalpPrices: ScalpPricesRow | null;
  tagIds: string[];
}

export interface TradeFilter {
  strategy?: string;
  book?: string;
  underlying?: string;
  includeExcluded?: boolean;
  /** At most this many trades, newest first; 500 when left out, every trade when null. */
  limit?: number | null;
}

export type PriceSide = "entry" | "exit";

/** A fly the move filler should look at, and which of its stock prices are missing. */
export interface PriceGap {
  tradeId: string;
  underlying: string;
  openedAt: number;
  closedAt: number | null;
  missingEntry: boolean;
  /** Only a closed trade has an exit price to fetch. */
  missingExit: boolean;
}

/** A scalp the price filler should look at (scalp-R spec §7). */
export interface ScalpPriceGap {
  tradeId: string;
  underlying: string;
  openedAt: number;
  closedAt: number | null;
}

/** The same minute reads the same bar, so only a change of minute makes a stored price stale (spec §5.4). */
const sameMoment = (a: number | null, b: number | null) =>
  a === b || (a != null && b != null && sessionMoment(a) === sessionMoment(b));

/** The stored stock prices an edit makes stale: a new ticker, or a time moved to another minute. */
export function stalePrices(
  existing: TradeRow,
  patch: Pick<TradePatch, "underlying" | "openedAt" | "closedAt">,
) {
  const cleared: { underlyingPriceEntry?: null; underlyingPriceExit?: null } = {};
  const newTicker = patch.underlying !== undefined && patch.underlying !== existing.underlying;
  if (newTicker || (patch.openedAt !== undefined && !sameMoment(patch.openedAt, existing.openedAt))) {
    cleared.underlyingPriceEntry = null;
  }
  if (newTicker || (patch.closedAt !== undefined && !sameMoment(patch.closedAt, existing.closedAt))) {
    cleared.underlyingPriceExit = null;
  }
  return cleared;
}

const SYNC_SCALARS = [
  "strategy",
  "book",
  "underlying",
  "structureLabel",
  "netPnl",
  "fees",
  "feesOpen",
  "feesClose",
] as const;
const FLY_STRUCTURE = [
  "bodyPutStrike",
  "bodyCallStrike",
  "putWingStrike",
  "callWingStrike",
  "contracts",
  "creditPerShare",
  "netCost",
] as const;

/** The edit forms keep minutes, not seconds, so a time only changes when its minute does. */
const minuteOf = (at: number | null | undefined) => (at == null ? null : Math.floor(at / 60_000));

/**
 * A scalp's fetched prices go stale with a new ticker, or a time moved to another minute (scalp-R spec §7). Minutes
 * are compared as they are, not clamped to the session as a fly's are: scalps read extended-hours bars.
 */
export function staleScalpPrices(
  existing: TradeRow,
  patch: Pick<TradePatch, "underlying" | "openedAt" | "closedAt">,
): boolean {
  return (
    (patch.underlying !== undefined && patch.underlying !== existing.underlying) ||
    (patch.openedAt !== undefined && minuteOf(patch.openedAt) !== minuteOf(existing.openedAt)) ||
    (patch.closedAt !== undefined && minuteOf(patch.closedAt) !== minuteOf(existing.closedAt))
  );
}

const legKey = (leg: {
  right: string;
  strike: number;
  expiry: string;
  quantity: number;
  multiplier: number;
  openPrice: number;
  closePrice: number | null;
}) =>
  JSON.stringify([
    leg.right,
    leg.strike,
    leg.expiry,
    leg.quantity,
    leg.multiplier,
    leg.openPrice,
    leg.closePrice,
  ]);

/**
 * Whether a patch changes a broker fact: a leg, a price, a size, a time (to the minute), fees, P&L or a fly's
 * structure (spec §5.3). The forms send every fact on each save, so values are compared, not just keys.
 */
export function changesFacts(existing: TradeRecord, patch: TradePatch): boolean {
  for (const key of SYNC_SCALARS) {
    if (patch[key] !== undefined && patch[key] !== existing[key]) return true;
  }
  if (patch.openedAt !== undefined && minuteOf(patch.openedAt) !== minuteOf(existing.openedAt)) return true;
  if (patch.closedAt !== undefined && minuteOf(patch.closedAt) !== minuteOf(existing.closedAt)) return true;
  if (patch.legs !== undefined) {
    const before = existing.legs.map(legKey).sort();
    const after = patch.legs.map(legKey).sort();
    if (before.length !== after.length || before.some((key, index) => key !== after[index])) return true;
  }
  if (patch.ironFly !== undefined) {
    if (!patch.ironFly || !existing.ironFly) return Boolean(patch.ironFly) !== Boolean(existing.ironFly);
    for (const key of FLY_STRUCTURE) {
      if (patch.ironFly[key] !== existing.ironFly[key]) return true;
    }
  }
  return false;
}

/** The transaction handle drizzle hands to a callback, which supports the same query builders. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbLike = Db | Tx;

/** A patch the review rules refuse (scalp-review spec §6.2). The route answers 400 with the message. */
export class ReviewRuleError extends Error {}

/** What a scalp holds: the long leg's right when it's one long option, and its contracts. */
export interface ScalpPosition {
  right: string | null;
  size: number;
}

function positionOf(legList: readonly { right: string; quantity: number }[]): ScalpPosition {
  const only = legList.length === 1 ? legList[0] : undefined;
  return { right: only && only.quantity > 0 ? only.right : null, size: contractsHeld(legList) };
}

/**
 * A scalp's levels after a patch (scalp-review spec §6.2, scalp-R spec §8). The first write needs a basis.
 * - A new basis clears the stop and targets unless the patch sets them, because a stock level means nothing as a
 *   premium. The overrides stay.
 * - Prices round to the cent, and targets are kept in the order the trade reaches them.
 * - Sent targets may trim no more than the position holds. Stored ones aren't checked again, so a size edit never
 *   blocks a stop.
 */
export function mergeLevels(
  tradeId: string,
  existing: ScalpLevels | null,
  patch: NonNullable<TradePatch["scalp"]>,
  position: ScalpPosition,
): ScalpLevels {
  const levelBasis = patch.levelBasis ?? existing?.levelBasis;
  if (!levelBasis) throw new ReviewRuleError("A scalp's first level needs a basis");
  const kept = existing?.levelBasis === levelBasis ? existing : null;
  // Each value is judged at the cent it's stored at: 0.004 is refused as the 0 it would become.
  const level = (value: number) => {
    const cents = round2(value);
    if (levelBasis === "stock" && cents <= 0) throw new ReviewRuleError("A stock price must be above 0");
    return cents;
  };
  const stop = patch.stopPrice === undefined ? (kept?.stopPrice ?? null) : patch.stopPrice;
  let targets = kept?.targets ?? [];
  if (patch.targets !== undefined) {
    targets = patch.targets.map((target) => ({ price: level(target.price), contracts: target.contracts }));
    const refused = trimProblem(targets, position.size);
    if (refused) throw new ReviewRuleError(refused);
  }
  const override = (sent: number | null | undefined, stored: number | null, message: string) => {
    const value = sent === undefined ? stored : sent;
    const cents = value == null ? null : round2(value);
    if (cents != null && cents <= 0) throw new ReviewRuleError(message);
    return cents;
  };
  return {
    tradeId,
    levelBasis,
    stopPrice: stop == null ? null : level(stop),
    stockEntryOverride: override(
      patch.stockEntryOverride,
      existing?.stockEntryOverride ?? null,
      "A stock price must be above 0",
    ),
    riskOverride: override(
      patch.riskOverride,
      existing?.riskOverride ?? null,
      "A planned risk must be above 0",
    ),
    targets: sortTargets(targets, levelBasis, position.right),
  };
}

export function createTradesRepo(db: Db, now: () => number = Date.now) {
  function levelsOf(conn: DbLike, tradeId: string): ScalpLevels | null {
    const row = conn.select().from(scalpDetails).where(eq(scalpDetails.tradeId, tradeId)).get();
    if (!row) return null;
    const targets = conn
      .select({ price: scalpTargets.price, contracts: scalpTargets.contracts })
      .from(scalpTargets)
      .where(eq(scalpTargets.tradeId, tradeId))
      .orderBy(asc(scalpTargets.position))
      .all();
    return { ...row, targets };
  }

  function hydrate(conn: DbLike, row: TradeRow): TradeRecord {
    return {
      ...row,
      legs: conn
        .select()
        .from(legs)
        .where(and(eq(legs.tradeId, row.id), isNull(legs.deletedAt)))
        .all(),
      ironFly: conn.select().from(ironFlyDetails).where(eq(ironFlyDetails.tradeId, row.id)).get() ?? null,
      scalp: levelsOf(conn, row.id),
      scalpPrices: conn.select().from(scalpPrices).where(eq(scalpPrices.tradeId, row.id)).get() ?? null,
      tagIds: conn
        .select({ tagId: tradeTags.tagId })
        .from(tradeTags)
        .where(eq(tradeTags.tradeId, row.id))
        .all()
        .map((link) => link.tagId),
    };
  }

  function requireRow(conn: DbLike, id: string): TradeRecord {
    const row = conn.select().from(trades).where(eq(trades.id, id)).get();
    if (!row) throw new Error(`trade ${id} vanished mid-write`);
    return hydrate(conn, row);
  }

  /** At most one emotion tag per trade (scalp-review spec §6.2). */
  function checkOneEmotion(tagIds: readonly string[]): void {
    if (tagIds.length < 2) return;
    const emotions = db
      .select({ id: tags.id })
      .from(tags)
      .where(and(inArray(tags.id, [...tagIds]), eq(tags.kind, "emotion")))
      .all();
    if (emotions.length > 1) throw new ReviewRuleError("A trade has at most one emotion");
  }

  /** Children are replaced wholesale, and only when the input mentions them. */
  function writeChildren(conn: DbLike, tradeId: string, input: Partial<NewTrade>, timestamp: number): void {
    if (input.legs) {
      conn.delete(legs).where(eq(legs.tradeId, tradeId)).run();
      for (const leg of input.legs) {
        conn
          .insert(legs)
          .values({
            id: crypto.randomUUID(),
            tradeId,
            right: leg.right,
            strike: leg.strike,
            expiry: leg.expiry,
            quantity: leg.quantity,
            multiplier: leg.multiplier,
            openPrice: leg.openPrice,
            closePrice: leg.closePrice,
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
          })
          .run();
      }
    }

    if (input.ironFly === null) {
      conn.delete(ironFlyDetails).where(eq(ironFlyDetails.tradeId, tradeId)).run();
    } else if (input.ironFly) {
      // In place, so the columns no input carries (the stock prices) survive an edit.
      conn
        .insert(ironFlyDetails)
        .values({ tradeId, ...input.ironFly })
        .onConflictDoUpdate({ target: ironFlyDetails.tradeId, set: { ...input.ironFly } })
        .run();
    }

    if (input.tagIds) {
      conn.delete(tradeTags).where(eq(tradeTags.tradeId, tradeId)).run();
      for (const tagId of input.tagIds) conn.insert(tradeTags).values({ tradeId, tagId }).run();
    }
  }

  function insertTrade(
    conn: DbLike,
    id: string,
    input: NewTrade,
    timestamp: number,
    importBatchId: string | null,
  ) {
    conn
      .insert(trades)
      .values({
        id,
        strategy: input.strategy,
        book: input.book,
        accountId: null,
        underlying: input.underlying,
        underlyingName: input.underlyingName,
        structureLabel: input.structureLabel,
        openedAt: input.openedAt,
        closedAt: input.closedAt,
        netPnl: input.netPnl,
        fees: input.fees,
        feesOpen: input.feesOpen,
        feesClose: input.feesClose,
        notes: input.notes,
        grade: input.grade,
        setupId: input.setupId,
        excluded: input.excluded,
        excludeReason: input.excludeReason,
        source: input.source,
        externalRef: null,
        importBatchId,
        // Typing a trade in by hand is a user edit; an import is not.
        editedAt: input.source === "manual" ? timestamp : null,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      })
      .run();
    writeChildren(conn, id, input, timestamp);
  }

  return {
    create(input: NewTrade): TradeRecord {
      const timestamp = now();
      const id = crypto.randomUUID();
      return db.transaction((tx) => {
        insertTrade(tx, id, input, timestamp, null);
        return requireRow(tx, id);
      });
    },

    /** Every id already stored, soft-deleted included, so a deleted import stays deleted. */
    existingIds(ids: string[]): Set<string> {
      if (ids.length === 0) return new Set();
      const rows = db.select({ id: trades.id }).from(trades).where(inArray(trades.id, ids)).all();
      return new Set(rows.map((row) => row.id));
    },

    /** All or nothing: one failing trade rolls back the whole batch. */
    importMany(items: { id: string; trade: NewTrade }[], importBatchId: string): number {
      const timestamp = now();
      db.transaction((tx) => {
        for (const item of items) insertTrade(tx, item.id, item.trade, timestamp, importBatchId);
      });
      return items.length;
    },

    get(id: string): TradeRecord | null {
      const row = db
        .select()
        .from(trades)
        .where(and(eq(trades.id, id), isNull(trades.deletedAt)))
        .get();
      return row ? hydrate(db, row) : null;
    },

    list(filter: TradeFilter = {}): TradeRecord[] {
      const conditions = [isNull(trades.deletedAt)];
      if (filter.strategy) conditions.push(eq(trades.strategy, filter.strategy));
      if (filter.book) conditions.push(eq(trades.book, filter.book));
      if (filter.underlying) conditions.push(eq(trades.underlying, filter.underlying.toUpperCase()));
      if (!filter.includeExcluded) conditions.push(eq(trades.excluded, false));
      return (
        db
          .select()
          .from(trades)
          .where(and(...conditions))
          // Ties by id, as the web orders the review queue, so the server's queue matches it.
          .orderBy(desc(trades.openedAt), desc(trades.id))
          // SQLite reads a negative LIMIT as no limit.
          .limit(filter.limit === null ? -1 : (filter.limit ?? 500))
          .all()
          .map((row) => hydrate(db, row))
      );
    },

    update(id: string, patch: TradePatch): TradeRecord | null {
      const existing = db
        .select()
        .from(trades)
        .where(and(eq(trades.id, id), isNull(trades.deletedAt)))
        .get();
      if (!existing) return null;

      const timestamp = now();
      const { legs: _legs, ironFly: _ironFly, tagIds: _tagIds, scalp, reviewed, ...rest } = patch;
      // Drop keys the caller never sent, so a patch only touches what it names.
      const columns = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
      // The review rules (scalp-review spec §6.2) are checked before anything is written.
      if (scalp && (patch.strategy ?? existing.strategy) !== "scalp") {
        throw new ReviewRuleError("Only a scalp has a stop and target");
      }
      const record = hydrate(db, existing);
      const levels = scalp
        ? mergeLevels(id, record.scalp, scalp, positionOf(patch.legs ?? record.legs))
        : null;
      if (patch.tagIds) checkOneEmotion(patch.tagIds);

      const factsEdited = changesFacts(record, patch);
      return db.transaction((tx) => {
        tx.update(trades)
          .set({
            ...columns,
            ...(reviewed === undefined ? {} : { reviewedAt: reviewed ? timestamp : null }),
            updatedAt: timestamp,
            editedAt: timestamp,
            ...(factsEdited ? { factsEditedAt: timestamp } : {}),
          })
          .where(eq(trades.id, id))
          .run();
        writeChildren(tx, id, patch, timestamp);
        if (levels) {
          const { targets, ...row } = levels;
          tx.insert(scalpDetails)
            .values(row)
            .onConflictDoUpdate({ target: scalpDetails.tradeId, set: row })
            .run();
          tx.delete(scalpTargets).where(eq(scalpTargets.tradeId, id)).run();
          for (const [index, target] of targets.entries()) {
            tx.insert(scalpTargets)
              .values({ tradeId: id, position: index + 1, ...target })
              .run();
          }
        }
        const cleared = stalePrices(existing, patch);
        if (Object.keys(cleared).length > 0) {
          tx.update(ironFlyDetails).set(cleared).where(eq(ironFlyDetails.tradeId, id)).run();
        }
        if (staleScalpPrices(existing, patch)) {
          tx.delete(scalpPrices).where(eq(scalpPrices.tradeId, id)).run();
        }
        return requireRow(tx, id);
      });
    },

    softDelete(id: string): boolean {
      const timestamp = now();
      const result = db
        .update(trades)
        .set({ deletedAt: timestamp, updatedAt: timestamp })
        .where(and(eq(trades.id, id), isNull(trades.deletedAt)))
        .run();
      return result.changes > 0;
    },

    /** "Use IBKR's numbers": the next sync may write this trade again. Only IBKR trades carry the mark. */
    clearFactsEdited(id: string): boolean {
      const result = db
        .update(trades)
        .set({ factsEditedAt: null, updatedAt: now() })
        .where(and(eq(trades.id, id), eq(trades.source, "ibkr_flex"), isNull(trades.deletedAt)))
        .run();
      return result.changes > 0;
    },

    /** Iron flies missing a stock price the filler can fetch, oldest first (spec §8.1). Excluded ones count. */
    missingPrices(tradeIds?: readonly string[]): PriceGap[] {
      if (tradeIds?.length === 0) return [];
      const conditions = [
        eq(trades.strategy, "iron_fly"),
        isNull(trades.deletedAt),
        or(
          isNull(ironFlyDetails.underlyingPriceEntry),
          and(isNotNull(trades.closedAt), isNull(ironFlyDetails.underlyingPriceExit)),
        ),
      ];
      if (tradeIds) conditions.push(inArray(trades.id, [...tradeIds]));
      return db
        .select({
          tradeId: trades.id,
          underlying: trades.underlying,
          openedAt: trades.openedAt,
          closedAt: trades.closedAt,
          entry: ironFlyDetails.underlyingPriceEntry,
          exit: ironFlyDetails.underlyingPriceExit,
        })
        .from(trades)
        .innerJoin(ironFlyDetails, eq(ironFlyDetails.tradeId, trades.id))
        .where(and(...conditions))
        .orderBy(asc(trades.openedAt))
        .all()
        .map((row) => ({
          tradeId: row.tradeId,
          underlying: row.underlying,
          openedAt: row.openedAt,
          closedAt: row.closedAt,
          missingEntry: row.entry == null,
          missingExit: row.closedAt != null && row.exit == null,
        }));
    },

    /** Stores a price only where none is, so filling never overwrites. Not a user edit: no timestamp moves. */
    setUnderlyingPrice(tradeId: string, side: PriceSide, price: number): boolean {
      const result =
        side === "entry"
          ? db
              .update(ironFlyDetails)
              .set({ underlyingPriceEntry: price })
              .where(and(eq(ironFlyDetails.tradeId, tradeId), isNull(ironFlyDetails.underlyingPriceEntry)))
              .run()
          : db
              .update(ironFlyDetails)
              .set({ underlyingPriceExit: price })
              .where(and(eq(ironFlyDetails.tradeId, tradeId), isNull(ironFlyDetails.underlyingPriceExit)))
              .run();
      return result.changes > 0;
    },

    /**
     * Scalps missing a fetched price (scalp-R spec §7), oldest first: no stock at entry, or closed with no range yet.
     * Excluded ones count.
     */
    missingScalpPrices(tradeIds?: readonly string[]): ScalpPriceGap[] {
      if (tradeIds?.length === 0) return [];
      const conditions = [
        eq(trades.strategy, "scalp"),
        isNull(trades.deletedAt),
        or(isNull(scalpPrices.entryPrice), and(isNotNull(trades.closedAt), isNull(scalpPrices.holdHigh))),
      ];
      if (tradeIds) conditions.push(inArray(trades.id, [...tradeIds]));
      return db
        .select({
          tradeId: trades.id,
          underlying: trades.underlying,
          openedAt: trades.openedAt,
          closedAt: trades.closedAt,
        })
        .from(trades)
        .leftJoin(scalpPrices, eq(scalpPrices.tradeId, trades.id))
        .where(and(...conditions))
        .orderBy(asc(trades.openedAt))
        .all();
    },

    /** Stores what the filler found, keeping what an earlier run stored. Not a user edit: no timestamp moves. */
    setScalpPrices(
      tradeId: string,
      found: { entryPrice: number | null; holdHigh: number | null; holdLow: number | null },
      fetchedAt: number,
    ): void {
      const stored = db.select().from(scalpPrices).where(eq(scalpPrices.tradeId, tradeId)).get();
      const row = {
        tradeId,
        entryPrice: found.entryPrice ?? stored?.entryPrice ?? null,
        holdHigh: found.holdHigh ?? stored?.holdHigh ?? null,
        holdLow: found.holdLow ?? stored?.holdLow ?? null,
        fetchedAt,
      };
      db.insert(scalpPrices).values(row).onConflictDoUpdate({ target: scalpPrices.tradeId, set: row }).run();
    },
  };
}
