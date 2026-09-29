import { type NewTrade, round2, sessionMoment, type TradePatch } from "@tj/core";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { Db } from "../client.js";
import { ironFlyDetails, legs, scalpDetails, tags, trades, tradeTags } from "../schema.js";

export type TradeRow = typeof trades.$inferSelect;
export type LegRow = typeof legs.$inferSelect;
export type IronFlyRow = typeof ironFlyDetails.$inferSelect;
export type ScalpRow = typeof scalpDetails.$inferSelect;

export interface TradeRecord extends TradeRow {
  legs: LegRow[];
  ironFly: IronFlyRow | null;
  /** The scalp's stop and target (scalp-review spec §5); null until the first is set. */
  scalp: ScalpRow | null;
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

/**
 * A scalp's levels after a patch (scalp-review spec §6.2). The first write needs a basis. A new basis clears both
 * prices unless the patch sets them, because a stock level means nothing as a premium. Prices round to the cent.
 */
export function mergeLevels(
  tradeId: string,
  existing: ScalpRow | null,
  patch: NonNullable<TradePatch["scalp"]>,
): ScalpRow {
  const levelBasis = patch.levelBasis ?? existing?.levelBasis;
  if (!levelBasis) throw new ReviewRuleError("A scalp's first level needs a basis");
  const kept = existing?.levelBasis === levelBasis ? existing : null;
  const price = (sent: number | null | undefined, stored: number | null) => {
    const value = sent === undefined ? stored : sent;
    if (value == null) return null;
    if (levelBasis === "stock" && value <= 0) throw new ReviewRuleError("A stock price must be above 0");
    return round2(value);
  };
  return {
    tradeId,
    levelBasis,
    stopPrice: price(patch.stopPrice, kept?.stopPrice ?? null),
    targetPrice: price(patch.targetPrice, kept?.targetPrice ?? null),
  };
}

export function createTradesRepo(db: Db, now: () => number = Date.now) {
  function hydrate(conn: DbLike, row: TradeRow): TradeRecord {
    return {
      ...row,
      legs: conn
        .select()
        .from(legs)
        .where(and(eq(legs.tradeId, row.id), isNull(legs.deletedAt)))
        .all(),
      ironFly: conn.select().from(ironFlyDetails).where(eq(ironFlyDetails.tradeId, row.id)).get() ?? null,
      scalp: conn.select().from(scalpDetails).where(eq(scalpDetails.tradeId, row.id)).get() ?? null,
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
          .orderBy(desc(trades.openedAt))
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
      const levels = scalp
        ? mergeLevels(
            id,
            db.select().from(scalpDetails).where(eq(scalpDetails.tradeId, id)).get() ?? null,
            scalp,
          )
        : null;
      if (patch.tagIds) checkOneEmotion(patch.tagIds);

      const factsEdited = changesFacts(hydrate(db, existing), patch);
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
          tx.insert(scalpDetails)
            .values(levels)
            .onConflictDoUpdate({ target: scalpDetails.tradeId, set: levels })
            .run();
        }
        const cleared = stalePrices(existing, patch);
        if (Object.keys(cleared).length > 0) {
          tx.update(ironFlyDetails).set(cleared).where(eq(ironFlyDetails.tradeId, id)).run();
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
  };
}
