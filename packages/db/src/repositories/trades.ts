import { type NewTrade, sessionMoment, type TradePatch } from "@tj/core";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { Db } from "../client.js";
import { ironFlyDetails, legs, trades, tradeTags } from "../schema.js";

export type TradeRow = typeof trades.$inferSelect;
export type LegRow = typeof legs.$inferSelect;
export type IronFlyRow = typeof ironFlyDetails.$inferSelect;

export interface TradeRecord extends TradeRow {
  legs: LegRow[];
  ironFly: IronFlyRow | null;
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
function stalePrices(existing: TradeRow, patch: TradePatch) {
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

/** The transaction handle drizzle hands to a callback, which supports the same query builders. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbLike = Db | Tx;

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
      const { legs: _legs, ironFly: _ironFly, tagIds: _tagIds, ...rest } = patch;
      // Drop keys the caller never sent, so a patch only touches what it names.
      const columns = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));

      return db.transaction((tx) => {
        tx.update(trades)
          .set({ ...columns, updatedAt: timestamp, editedAt: timestamp })
          .where(eq(trades.id, id))
          .run();
        writeChildren(tx, id, patch, timestamp);
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
