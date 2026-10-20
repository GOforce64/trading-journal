import { createIbkrRepo, createTradesRepo, type Db, type FillInput, type FillRow } from "@tj/db";
import {
  accountIdFor,
  type FillForGrouping,
  type FlexClient,
  FlexError,
  FlexParseError,
  type FlexStatementData,
  fillIdFor,
  groupFills,
  type ParsedFill,
  parseFlex,
} from "@tj/importers";
import type { IbkrBook, IbkrConfig } from "../config.js";

/** An automatic sync (on app open) runs at most this often; the button always runs. */
export const AUTO_INTERVAL_MS = 15 * 60_000;
/**
 * How long a sync waits for IBKR in all, both statements together: each used to get two minutes of its own, four in
 * all. Today's statement is usually ready in seconds; an Activity statement out of time leaves today's applied.
 */
export const SYNC_PATIENCE_MS = 150_000;

/** Each book's row in `sync_state`: paper keeps the source it always had (live-sync spec §4). */
export const SYNC_SOURCE: Record<IbkrBook, string> = { paper: "ibkr", live: "ibkr_live" };
/** Paper first, wherever the accounts are listed. */
const BOOKS: readonly IbkrBook[] = ["paper", "live"];

// Unions are spelled out: the web infers these types over RPC and must be able to print them (TS2742).
/** What one account's sync did (spec §8.2). */
export interface SyncSummary {
  /** The credentials it ran with; `account` says what IBKR's statement held. */
  book: "paper" | "live";
  status: "ok" | "error";
  ran: boolean;
  account: { externalId: string; kind: "paper" | "live" } | null;
  added: number;
  updated: number;
  unchanged: number;
  orphaned: number;
  skipped: {
    reason: "before_start" | "unrecognised" | "duplicate" | "deleted";
    ticker: string;
    openedAt: number;
  }[];
  keptEdits: { tradeId: string; ticker: string; netPnl: number | null }[];
  ignored: { beforeStart: number; stock: number; other: number; malformed: number };
  activityFailed: boolean;
  changedTradeIds: string[];
  error: { kind: "token" | "query" | "slow" | "unreachable" | "failed"; message: string } | null;
  lastRunAt: number | null;
}

/** One sync of every account that's set up (live-sync spec §4). */
export interface SyncReport {
  /** Whether any account ran, rather than answering from its last run. */
  ran: boolean;
  /** Every account's added or updated trades, for the browser's move-data and price fill. */
  changedTradeIds: string[];
  /** One per account set up, paper first; none when neither is. */
  accounts: SyncSummary[];
}

export interface IbkrAccountStatus {
  book: "paper" | "live";
  since: string;
  lastRunAt: number | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  lastSummary: SyncSummary | null;
}

export interface IbkrStatus {
  configured: boolean;
  /** The accounts set up, paper first. */
  accounts: IbkrAccountStatus[];
}

export interface IbkrSync {
  /** One run at a time: a call during a run gets that run's report. */
  sync(options: { auto: boolean }): Promise<SyncReport>;
  status(): IbkrStatus;
  /** "Use IBKR's numbers": clears the user's mark on a synced trade and syncs. Null for any other trade. */
  reset(tradeId: string): Promise<SyncReport | null>;
}

export interface IbkrSyncDeps {
  db: Db;
  /** A book's credentials, read on every sync; null, or a throw, means that book isn't set up. */
  config: (book: IbkrBook) => IbkrConfig | null;
  client: (token: string) => FlexClient;
  now?: () => number;
}

const emptySummary = (book: IbkrBook): SyncSummary => ({
  book,
  status: "ok",
  ran: true,
  account: null,
  added: 0,
  updated: 0,
  unchanged: 0,
  orphaned: 0,
  skipped: [],
  keptEdits: [],
  ignored: { beforeStart: 0, stock: 0, other: 0, malformed: 0 },
  activityFailed: false,
  changedTradeIds: [],
  error: null,
  lastRunAt: null,
});

const toInput = (account: string, fill: ParsedFill): FillInput => ({
  id: fillIdFor(account, fill.key),
  brokerExecKey: fill.key,
  brokerTradeId: fill.tradeId,
  brokerOrderId: fill.orderId,
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
  raw: fill.raw,
});

const toGrouping = (row: FillRow): FillForGrouping => ({
  id: row.id,
  key: row.brokerExecKey,
  conid: row.conid,
  underlying: row.underlying,
  right: row.right === "P" ? "P" : "C",
  strike: row.strike,
  expiry: row.expiry,
  multiplier: row.multiplier,
  executedAt: row.executedAt,
  quantity: row.quantity,
  price: row.price,
  commission: row.commission,
  openClose: row.openClose === "O" || row.openClose === "C" || row.openClose === "C;O" ? row.openClose : null,
  kind:
    row.kind === "expiration" || row.kind === "exercise" || row.kind === "assignment" ? row.kind : "trade",
});

/** A stored summary, from before live existed too, when it carried no book. */
const storedSummary = (stored: unknown, book: IbkrBook): SyncSummary => ({
  ...(stored as SyncSummary),
  book,
});

/**
 * The IBKR sync (spec §8.1): for each account set up, fetch both statements, store fills, regroup, write, all after
 * IBKR has answered. The accounts run side by side (live-sync spec §4).
 */
export function createIbkrSync({ db, config, client, now = Date.now }: IbkrSyncDeps): IbkrSync {
  const repo = createIbkrRepo(db, now);
  let running: Promise<SyncReport> | null = null;

  /** The books set up, paper first: a book whose entry can't be read is left out, and never stops the other. */
  const configured = (): [IbkrBook, IbkrConfig][] =>
    BOOKS.flatMap((book): [IbkrBook, IbkrConfig][] => {
      try {
        const settings = config(book);
        return settings ? [[book, settings]] : [];
      } catch {
        return [];
      }
    });

  function fail(error: unknown, accountId: string | null, book: IbkrBook): SyncSummary {
    const flex =
      error instanceof FlexError
        ? error
        : new FlexError(
            "failed",
            error instanceof FlexParseError ? error.message : "The sync failed unexpectedly.",
          );
    const at = now();
    const summary: SyncSummary = {
      ...emptySummary(book),
      status: "error",
      error: { kind: flex.kind, message: flex.message },
      lastRunAt: at,
    };
    repo.recordRun(SYNC_SOURCE[book], { at, status: "error", error: flex.message, summary, accountId });
    return summary;
  }

  async function runBook(
    book: IbkrBook,
    settings: IbkrConfig,
    { auto }: { auto: boolean },
  ): Promise<SyncSummary> {
    const last = repo.lastRun(SYNC_SOURCE[book]);
    if (auto && last?.lastSummary && now() - last.lastRunAt < AUTO_INTERVAL_MS) {
      // The last run's counts for the card, but nothing changed now: no ids for the page to fill prices for again.
      return { ...storedSummary(last.lastSummary, book), ran: false, changedTradeIds: [] };
    }

    const flex = client(settings.token);
    const until = now() + SYNC_PATIENCE_MS;
    let today: FlexStatementData;
    try {
      today = parseFlex(await flex.statement(settings.todayQueryId, until));
    } catch (error) {
      return fail(error, last?.accountId ?? null, book);
    }
    let activity: FlexStatementData | null = null;
    let activityFailed = false;
    try {
      activity = parseFlex(await flex.statement(settings.activityQueryId, until));
    } catch (error) {
      if (error instanceof FlexError && (error.kind === "token" || error.kind === "query")) {
        return fail(error, last?.accountId ?? null, book);
      }
      activityFailed = true;
    }
    if (activity && activity.accountId !== today.accountId) {
      return fail(
        new FlexError(
          "failed",
          `The two queries belong to different accounts (${today.accountId} and ${activity.accountId}). Use queries from the same account.`,
        ),
        null,
        book,
      );
    }

    const externalId = today.accountId;
    const account = {
      id: accountIdFor(externalId),
      externalId,
      kind: externalId.startsWith("DU") ? ("paper" as const) : ("live" as const),
    };
    if (account.kind !== book) {
      // Paper's queries saved as live, or the other way round: nothing is stored under the wrong book.
      return fail(
        new FlexError(
          "failed",
          `These queries belong to the ${account.kind} account ${externalId}: use the ${book} account's own queries.`,
        ),
        null,
        book,
      );
    }
    const at = now();
    const summary: SyncSummary = {
      ...emptySummary(book),
      account: { externalId, kind: account.kind },
      activityFailed,
      lastRunAt: at,
    };
    try {
      db.transaction(() => {
        repo.ensureAccount(account);
        // Today first, so Activity's final version of the same fill replaces it.
        for (const statement of [today, activity]) {
          if (!statement) continue;
          summary.ignored.stock += statement.ignored.stock;
          summary.ignored.other += statement.ignored.other;
          summary.ignored.malformed += statement.ignored.malformed;
          const kept = statement.fills.filter((fill) => fill.tradeDate >= settings.since);
          summary.ignored.beforeStart += statement.fills.length - kept.length;
          repo.storeFills(
            account.id,
            kept.map((fill) => toInput(externalId, fill)),
            statement.kind,
          );
          repo.markCanceled(
            account.id,
            // A cancel from before the start date names a fill that was never stored; applied, it would fall on
            // a later correction booked under the same trade id.
            statement.cancels
              .filter((cancel) => cancel.tradeDate >= settings.since)
              .map((cancel) => ({
                brokerTradeId: cancel.tradeId,
                quantity: cancel.quantity,
                price: cancel.price,
              })),
          );
        }

        const stored = repo.fillsSince(account.id, settings.since);
        const grouped = groupFills(stored.map(toGrouping), {
          account: externalId,
          book: account.kind,
        });
        // A trade whose fills now sit in an episode grouping can't place is kept as it was, links and all, not
        // orphaned: the skip says why, and the user's notes on it survive.
        const unplaced = new Set(grouped.skipped.flatMap((skip) => skip.fillIds));
        const held = new Map<string, { tradeId: string; legId: string }>();
        for (const fill of stored) {
          if (unplaced.has(fill.id) && fill.tradeId && fill.legId) {
            held.set(fill.id, { tradeId: fill.tradeId, legId: fill.legId });
          }
        }
        for (const skip of grouped.skipped) {
          summary.skipped.push({ reason: skip.reason, ticker: skip.ticker, openedAt: skip.openedAt });
        }
        const linked = new Set<string>();
        for (const candidate of grouped.candidates) {
          const ticker = candidate.trade.underlying;
          if (!repo.tradeExists(candidate.id) && repo.isDuplicate(candidate)) {
            summary.skipped.push({ reason: "duplicate", ticker, openedAt: candidate.trade.openedAt });
            continue;
          }
          const result = repo.apply(candidate, account.id);
          linked.add(candidate.id);
          if (result === "added") summary.added++;
          else if (result === "updated") summary.updated++;
          else if (result === "unchanged") summary.unchanged++;
          else if (result === "deleted") {
            summary.skipped.push({ reason: "deleted", ticker, openedAt: candidate.trade.openedAt });
          } else summary.keptEdits.push({ tradeId: candidate.id, ticker, netPnl: candidate.trade.netPnl });
          if (result === "added" || result === "updated") summary.changedTradeIds.push(candidate.id);
        }
        summary.orphaned = repo.softDeleteOrphans(
          account.id,
          new Set([
            ...grouped.candidates.map((candidate) => candidate.id),
            ...[...held.values()].map((link) => link.tradeId),
          ]),
          settings.since,
        );
        repo.linkFills(
          account.id,
          new Map([...[...grouped.links].filter(([, link]) => linked.has(link.tradeId)), ...held]),
        );
        repo.recordRun(SYNC_SOURCE[book], { at, status: "ok", error: null, summary, accountId: account.id });
      });
    } catch (error) {
      console.error("IBKR sync failed while saving:", error instanceof Error ? error.message : error);
      return fail(new FlexError("failed", "The sync couldn't save what IBKR sent."), account.id, book);
    }
    return summary;
  }

  async function run(options: { auto: boolean }): Promise<SyncReport> {
    const accounts = await Promise.all(
      configured().map(([book, settings]) =>
        runBook(book, settings, options).catch((error: unknown) => fail(error, null, book)),
      ),
    );
    return {
      ran: accounts.some((summary) => summary.ran),
      changedTradeIds: accounts.flatMap((summary) => summary.changedTradeIds),
      accounts,
    };
  }

  const sync: IbkrSync["sync"] = (options) => {
    if (running) return running;
    running = run(options).finally(() => {
      running = null;
    });
    return running;
  };

  return {
    sync,
    status() {
      const accounts = configured().map(([book, settings]): IbkrAccountStatus => {
        const last = repo.lastRun(SYNC_SOURCE[book]);
        return {
          book,
          since: settings.since,
          lastRunAt: last?.lastRunAt ?? null,
          lastStatus: last?.lastStatus ?? null,
          lastError: last?.lastError ?? null,
          lastSummary: last?.lastSummary ? storedSummary(last.lastSummary, book) : null,
        };
      });
      return { configured: accounts.length > 0, accounts };
    },
    async reset(tradeId) {
      if (!createTradesRepo(db, now).clearFactsEdited(tradeId)) return null;
      return sync({ auto: false });
    },
  };
}
