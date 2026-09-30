import { type NewTrade, nyDate } from "@tj/core";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { Db } from "../client.js";
import { accounts, fills, ironFlyDetails, legs, scalpPrices, syncState, trades } from "../schema.js";
import { stalePrices, staleScalpPrices } from "./trades.js";

export type FillRow = typeof fills.$inferSelect;

/** A parsed fill with its id, as the sync stores it. */
export interface FillInput {
  id: string;
  brokerExecKey: string;
  brokerTradeId: string;
  brokerOrderId: string | null;
  conid: string;
  underlying: string;
  right: "C" | "P";
  strike: number;
  expiry: string;
  multiplier: number;
  tradeDate: string;
  executedAt: number;
  quantity: number;
  price: number;
  commission: number;
  openClose: "O" | "C" | null;
  kind: "trade" | "expiration" | "exercise" | "assignment";
  raw: Record<string, string>;
}

export interface CancelInput {
  brokerTradeId: string;
  quantity: number;
  price: number;
}

/** A trade candidate from grouping: its id, the trade, and one id per leg. */
export interface SyncedTradeInput {
  id: string;
  trade: NewTrade;
  legIds: string[];
}

export type ApplyResult = "added" | "updated" | "unchanged" | "deleted" | "kept_edits";

export interface IbkrAccount {
  id: string;
  externalId: string;
  kind: "paper" | "live";
}

export interface SyncRun {
  at: number;
  status: "ok" | "error";
  error: string | null;
  summary: unknown;
  accountId: string | null;
}

export interface LastRun {
  accountId: string | null;
  lastRunAt: number;
  lastStatus: "ok" | "error";
  lastError: string | null;
  lastSummary: unknown;
}

const SOURCE = "ibkr";
const FLY_STRUCTURE = [
  "bodyPutStrike",
  "bodyCallStrike",
  "putWingStrike",
  "callWingStrike",
  "contracts",
  "creditPerShare",
  "netCost",
] as const;

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

/** The columns the sync owns on a trade (spec §5.5). */
function facts(trade: NewTrade, accountId: string) {
  return {
    strategy: trade.strategy,
    book: trade.book,
    underlying: trade.underlying,
    structureLabel: trade.structureLabel,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    netPnl: trade.netPnl,
    fees: trade.fees,
    feesOpen: trade.feesOpen,
    feesClose: trade.feesClose,
    accountId,
  };
}

/** Fills, sync runs, and synced trades written without touching the user's side (spec §8.1). */
export function createIbkrRepo(db: Db, now: () => number = Date.now) {
  function writeLegs(candidate: SyncedTradeInput, timestamp: number) {
    db.delete(legs).where(eq(legs.tradeId, candidate.id)).run();
    candidate.trade.legs.forEach((leg, index) => {
      db.insert(legs)
        .values({
          id: candidate.legIds[index] ?? `${candidate.id}:${index}`,
          tradeId: candidate.id,
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
    });
  }

  /** Writes a fly's structure in place, so its earnings fields, overrides and stock prices stay the user's. */
  function writeFly(candidate: SyncedTradeInput) {
    const fly = candidate.trade.ironFly;
    if (!fly) {
      db.delete(ironFlyDetails).where(eq(ironFlyDetails.tradeId, candidate.id)).run();
      return;
    }
    const structure = {
      bodyPutStrike: fly.bodyPutStrike,
      bodyCallStrike: fly.bodyCallStrike,
      putWingStrike: fly.putWingStrike,
      callWingStrike: fly.callWingStrike,
      contracts: fly.contracts,
      creditPerShare: fly.creditPerShare,
      netCost: fly.netCost,
    };
    db.insert(ironFlyDetails)
      .values({ tradeId: candidate.id, ...structure })
      .onConflictDoUpdate({ target: ironFlyDetails.tradeId, set: structure })
      .run();
  }

  function sameFacts(
    existing: typeof trades.$inferSelect,
    candidate: SyncedTradeInput,
    accountId: string,
  ): boolean {
    const want = facts(candidate.trade, accountId);
    for (const [key, value] of Object.entries(want)) {
      if (existing[key as keyof typeof want] !== value) return false;
    }
    const storedLegs = db
      .select()
      .from(legs)
      .where(and(eq(legs.tradeId, existing.id), isNull(legs.deletedAt)))
      .all()
      .map(legKey)
      .sort();
    const wantLegs = candidate.trade.legs.map(legKey).sort();
    if (storedLegs.length !== wantLegs.length || storedLegs.some((key, index) => key !== wantLegs[index]))
      return false;
    const fly = db.select().from(ironFlyDetails).where(eq(ironFlyDetails.tradeId, existing.id)).get();
    const wantFly = candidate.trade.ironFly;
    if (!fly || !wantFly) return !fly && !wantFly;
    return FLY_STRUCTURE.every((key) => fly[key] === wantFly[key]);
  }

  /** The same trade from another source: a fly by ticker, body, expiry and New York day; a scalp by contract and day. */
  function matches(trade: NewTrade, amongSynced: boolean): boolean {
    const day = nyDate(trade.openedAt);
    const first = trade.legs[0];
    const others = db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.underlying, trade.underlying),
          eq(trades.strategy, trade.strategy),
          amongSynced ? eq(trades.source, "ibkr_flex") : ne(trades.source, "ibkr_flex"),
          isNull(trades.deletedAt),
        ),
      )
      .all()
      .filter((other) => nyDate(other.openedAt) === day);
    for (const other of others) {
      const otherLegs = db
        .select()
        .from(legs)
        .where(and(eq(legs.tradeId, other.id), isNull(legs.deletedAt)))
        .all();
      if (trade.strategy === "iron_fly") {
        const theirs = db.select().from(ironFlyDetails).where(eq(ironFlyDetails.tradeId, other.id)).get();
        const ours = trade.ironFly;
        if (
          theirs &&
          ours &&
          theirs.bodyPutStrike === ours.bodyPutStrike &&
          theirs.bodyCallStrike === ours.bodyCallStrike &&
          otherLegs.some((leg) => leg.expiry === first?.expiry)
        ) {
          return true;
        }
      } else if (
        first &&
        otherLegs.some(
          (leg) => leg.right === first.right && leg.strike === first.strike && leg.expiry === first.expiry,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  return {
    ensureAccount(account: IbkrAccount): void {
      const timestamp = now();
      db.insert(accounts)
        .values({
          id: account.id,
          name: account.kind === "paper" ? "IBKR paper" : "IBKR live",
          broker: "ibkr",
          kind: account.kind,
          externalId: account.externalId,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        })
        .onConflictDoNothing()
        .run();
    },

    /** New fills are inserted. Activity's version of a fill replaces Today's, with the final commission. */
    storeFills(accountId: string, input: FillInput[], origin: "confirm" | "activity") {
      let inserted = 0;
      let updated = 0;
      const timestamp = now();
      for (const fill of input) {
        const existing = db.select().from(fills).where(eq(fills.id, fill.id)).get();
        const values = {
          brokerExecKey: fill.brokerExecKey,
          brokerTradeId: fill.brokerTradeId,
          brokerOrderId: fill.brokerOrderId,
          conid: fill.conid,
          underlying: fill.underlying,
          right: fill.right,
          strike: fill.strike,
          expiry: fill.expiry,
          multiplier: fill.multiplier,
          tradeDate: fill.tradeDate,
          executedAt: fill.executedAt,
          quantity: fill.quantity,
          price: fill.price,
          commission: fill.commission,
          openClose: fill.openClose,
          kind: fill.kind,
          origin,
          raw: JSON.stringify(fill.raw),
          updatedAt: timestamp,
        };
        if (!existing) {
          db.insert(fills)
            .values({
              id: fill.id,
              accountId,
              canceled: false,
              tradeId: null,
              legId: null,
              createdAt: timestamp,
              ...values,
            })
            .run();
          inserted++;
        } else if (origin === "activity" && existing.origin === "confirm") {
          db.update(fills).set(values).where(eq(fills.id, fill.id)).run();
          updated++;
        }
      }
      return { inserted, updated };
    },

    /** Each cancel marks the first matching fill by trade id, size and price; a correction under the same id stands. */
    markCanceled(accountId: string, cancels: CancelInput[]): number {
      // A statement repeats its cancels on every sync, so this must be idempotent: each trade id, size and price
      // cancels as many fills as it has cancel rows, the earliest by key. IBKR re-books a correction under a later
      // key, and it stays standing however often the same cancel is seen.
      const counts = new Map<string, { cancel: CancelInput; count: number }>();
      for (const cancel of cancels) {
        const key = JSON.stringify([cancel.brokerTradeId, cancel.quantity, cancel.price]);
        const entry = counts.get(key);
        if (entry) entry.count++;
        else counts.set(key, { cancel, count: 1 });
      }
      let marked = 0;
      for (const { cancel, count } of counts.values()) {
        const hits = db
          .select()
          .from(fills)
          .where(
            and(
              eq(fills.accountId, accountId),
              eq(fills.brokerTradeId, cancel.brokerTradeId),
              eq(fills.quantity, cancel.quantity),
            ),
          )
          .orderBy(asc(fills.brokerExecKey))
          .all()
          .filter((fill) => Math.abs(fill.price - cancel.price) < 1e-9)
          .slice(0, count);
        for (const hit of hits) {
          if (hit.canceled) continue;
          db.update(fills).set({ canceled: true, updatedAt: now() }).where(eq(fills.id, hit.id)).run();
          marked++;
        }
      }
      return marked;
    },

    fillsSince(accountId: string, since: string): FillRow[] {
      return db
        .select()
        .from(fills)
        .where(and(eq(fills.accountId, accountId), eq(fills.canceled, false)))
        .orderBy(asc(fills.executedAt), asc(fills.brokerExecKey))
        .all()
        .filter((fill) => fill.tradeDate >= since);
    },

    fillsForTrade(tradeId: string): FillRow[] {
      return db
        .select()
        .from(fills)
        .where(eq(fills.tradeId, tradeId))
        .orderBy(asc(fills.executedAt), asc(fills.brokerExecKey))
        .all();
    },

    /** Whether a trade row with this id exists at all, deleted or not. */
    tradeExists(id: string): boolean {
      return db.select({ id: trades.id }).from(trades).where(eq(trades.id, id)).get() !== undefined;
    },

    /**
     * Already in the journal from another source (spec §8.1): a fly with the same ticker, expiry and body opened
     * the same New York day, or a scalp on the same contract opened that day.
     */
    isDuplicate(candidate: SyncedTradeInput): boolean {
      return matches(candidate.trade, false);
    },

    /** The oQuants import's reverse guard: this trade was already synced from IBKR. */
    syncedFrom(trade: NewTrade): boolean {
      return matches(trade, true);
    },

    /** Inserts or rewrites the sync's side of a trade (spec §5.5). Never the user's side, a deleted trade, or edited facts. */
    apply(candidate: SyncedTradeInput, accountId: string): ApplyResult {
      const existing = db.select().from(trades).where(eq(trades.id, candidate.id)).get();
      if (existing?.deletedAt != null) return "deleted";
      const timestamp = now();
      if (!existing) {
        db.insert(trades)
          .values({
            id: candidate.id,
            ...facts(candidate.trade, accountId),
            underlyingName: null,
            notes: null,
            grade: null,
            setupId: null,
            excluded: false,
            excludeReason: null,
            source: "ibkr_flex",
            externalRef: null,
            importBatchId: null,
            editedAt: null,
            factsEditedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
          })
          .run();
        writeLegs(candidate, timestamp);
        writeFly(candidate);
        return "added";
      }
      const same = sameFacts(existing, candidate, accountId);
      if (existing.factsEditedAt != null) return same ? "unchanged" : "kept_edits";
      if (same) return "unchanged";
      db.update(trades)
        .set({ ...facts(candidate.trade, accountId), updatedAt: timestamp })
        .where(eq(trades.id, candidate.id))
        .run();
      writeLegs(candidate, timestamp);
      writeFly(candidate);
      const cleared = stalePrices(existing, candidate.trade);
      if (Object.keys(cleared).length > 0) {
        db.update(ironFlyDetails).set(cleared).where(eq(ironFlyDetails.tradeId, candidate.id)).run();
      }
      // A close or a time the sync moved makes a scalp's fetched prices stale too (scalp-R spec §7).
      if (staleScalpPrices(existing, candidate.trade)) {
        db.delete(scalpPrices).where(eq(scalpPrices.tradeId, candidate.id)).run();
      }
      return "updated";
    },

    /** Synced trades no group produced any more. Never one the user edited, nor one from before the start date. */
    softDeleteOrphans(accountId: string, produced: ReadonlySet<string>, since: string): number {
      const timestamp = now();
      let deleted = 0;
      const synced = db
        .select()
        .from(trades)
        .where(
          and(
            eq(trades.accountId, accountId),
            eq(trades.source, "ibkr_flex"),
            isNull(trades.deletedAt),
            isNull(trades.factsEditedAt),
          ),
        )
        .all();
      for (const trade of synced) {
        if (produced.has(trade.id) || nyDate(trade.openedAt) < since) continue;
        db.update(trades)
          .set({ deletedAt: timestamp, updatedAt: timestamp })
          .where(eq(trades.id, trade.id))
          .run();
        deleted++;
      }
      return deleted;
    },

    linkFills(accountId: string, links: ReadonlyMap<string, { tradeId: string; legId: string }>): void {
      db.update(fills).set({ tradeId: null, legId: null }).where(eq(fills.accountId, accountId)).run();
      for (const [fillId, link] of links) {
        db.update(fills).set({ tradeId: link.tradeId, legId: link.legId }).where(eq(fills.id, fillId)).run();
      }
    },

    recordRun(run: SyncRun): void {
      const values = {
        accountId: run.accountId,
        lastRunAt: run.at,
        lastStatus: run.status,
        lastError: run.error,
        lastSummary: JSON.stringify(run.summary),
      };
      db.insert(syncState)
        .values({ source: SOURCE, ...values })
        .onConflictDoUpdate({ target: syncState.source, set: values })
        .run();
    },

    lastRun(): LastRun | null {
      const row = db.select().from(syncState).where(eq(syncState.source, SOURCE)).get();
      if (!row) return null;
      return {
        accountId: row.accountId,
        lastRunAt: row.lastRunAt,
        lastStatus: row.lastStatus === "error" ? "error" : "ok",
        lastError: row.lastError,
        lastSummary: row.lastSummary ? (JSON.parse(row.lastSummary) as unknown) : null,
      };
    },
  };
}
