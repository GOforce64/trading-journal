import type { NewTrade, TradePatch } from "@tj/core";
import { and, desc, eq, isNull } from "drizzle-orm";
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
  limit?: number;
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

    if (input.ironFly !== undefined) {
      conn.delete(ironFlyDetails).where(eq(ironFlyDetails.tradeId, tradeId)).run();
      if (input.ironFly) {
        conn
          .insert(ironFlyDetails)
          .values({ tradeId, ...input.ironFly })
          .run();
      }
    }

    if (input.tagIds) {
      conn.delete(tradeTags).where(eq(tradeTags.tradeId, tradeId)).run();
      for (const tagId of input.tagIds) conn.insert(tradeTags).values({ tradeId, tagId }).run();
    }
  }

  return {
    create(input: NewTrade): TradeRecord {
      const timestamp = now();
      const id = crypto.randomUUID();
      return db.transaction((tx) => {
        tx.insert(trades)
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
            notes: input.notes,
            grade: input.grade,
            setupId: input.setupId,
            excluded: input.excluded,
            excludeReason: input.excludeReason,
            source: input.source,
            externalRef: null,
            importBatchId: null,
            // Typing a trade in by hand is a user edit; an import is not.
            editedAt: input.source === "manual" ? timestamp : null,
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
          })
          .run();
        writeChildren(tx, id, input, timestamp);
        return requireRow(tx, id);
      });
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
      return db
        .select()
        .from(trades)
        .where(and(...conditions))
        .orderBy(desc(trades.openedAt))
        .limit(filter.limit ?? 500)
        .all()
        .map((row) => hydrate(db, row));
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
  };
}
