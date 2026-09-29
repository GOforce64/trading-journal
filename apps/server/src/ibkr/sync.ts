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
import type { IbkrConfig } from "../config.js";

/** An automatic sync (on app open) runs at most this often; the button always runs. */
export const AUTO_INTERVAL_MS = 15 * 60_000;

// Unions are spelled out: the web infers these types over RPC and must be able to print them (TS2742).
export interface SyncSummary {
  status: "ok" | "error" | "not_configured";
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

export interface IbkrStatus {
  configured: boolean;
  since: string | null;
  lastRunAt: number | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  lastSummary: SyncSummary | null;
}

export interface IbkrSync {
  /** One run at a time: a call during a run gets that run's summary. */
  sync(options: { auto: boolean }): Promise<SyncSummary>;
  status(): IbkrStatus;
  /** "Use IBKR's numbers": clears the user's mark on a synced trade and syncs. Null for any other trade. */
  reset(tradeId: string): Promise<SyncSummary | null>;
}

export interface IbkrSyncDeps {
  db: Db;
  config: () => IbkrConfig | null;
  client: (token: string) => FlexClient;
  now?: () => number;
}

const emptySummary = (): SyncSummary => ({
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
  openClose: row.openClose === "O" || row.openClose === "C" ? row.openClose : null,
  kind:
    row.kind === "expiration" || row.kind === "exercise" || row.kind === "assignment" ? row.kind : "trade",
});

/** The IBKR sync (spec §8.1): fetch both statements, store fills, regroup, write, all after IBKR has answered. */
export function createIbkrSync({ db, config, client, now = Date.now }: IbkrSyncDeps): IbkrSync {
  const repo = createIbkrRepo(db, now);
  let running: Promise<SyncSummary> | null = null;

  const readConfig = (): IbkrConfig | null => {
    try {
      return config();
    } catch {
      return null;
    }
  };

  function fail(error: unknown, accountId: string | null): SyncSummary {
    const flex =
      error instanceof FlexError
        ? error
        : new FlexError(
            "failed",
            error instanceof FlexParseError ? error.message : "The sync failed unexpectedly.",
          );
    const at = now();
    const summary: SyncSummary = {
      ...emptySummary(),
      status: "error",
      error: { kind: flex.kind, message: flex.message },
      lastRunAt: at,
    };
    repo.recordRun({ at, status: "error", error: flex.message, summary, accountId });
    return summary;
  }

  async function run({ auto }: { auto: boolean }): Promise<SyncSummary> {
    const settings = readConfig();
    const last = repo.lastRun();
    if (!settings)
      return { ...emptySummary(), status: "not_configured", ran: false, lastRunAt: last?.lastRunAt ?? null };
    if (auto && last?.lastSummary && now() - last.lastRunAt < AUTO_INTERVAL_MS) {
      return { ...(last.lastSummary as SyncSummary), ran: false };
    }

    const flex = client(settings.token);
    let today: FlexStatementData;
    try {
      today = parseFlex(await flex.statement(settings.todayQueryId));
    } catch (error) {
      return fail(error, last?.accountId ?? null);
    }
    let activity: FlexStatementData | null = null;
    let activityFailed = false;
    try {
      activity = parseFlex(await flex.statement(settings.activityQueryId));
    } catch (error) {
      if (error instanceof FlexError && (error.kind === "token" || error.kind === "query")) {
        return fail(error, last?.accountId ?? null);
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
      );
    }

    const externalId = today.accountId;
    const account = {
      id: accountIdFor(externalId),
      externalId,
      kind: externalId.startsWith("DU") ? ("paper" as const) : ("live" as const),
    };
    const at = now();
    const summary: SyncSummary = {
      ...emptySummary(),
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

        const grouped = groupFills(repo.fillsSince(account.id, settings.since).map(toGrouping), {
          account: externalId,
          book: account.kind,
        });
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
          new Set(grouped.candidates.map((candidate) => candidate.id)),
          settings.since,
        );
        repo.linkFills(
          account.id,
          new Map([...grouped.links].filter(([, link]) => linked.has(link.tradeId))),
        );
        repo.recordRun({ at, status: "ok", error: null, summary, accountId: account.id });
      });
    } catch (error) {
      console.error("IBKR sync failed while saving:", error instanceof Error ? error.message : error);
      return fail(new FlexError("failed", "The sync couldn't save what IBKR sent."), account.id);
    }
    return summary;
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
      const settings = readConfig();
      const last = repo.lastRun();
      return {
        configured: settings != null,
        since: settings?.since ?? null,
        lastRunAt: last?.lastRunAt ?? null,
        lastStatus: last?.lastStatus ?? null,
        lastError: last?.lastError ?? null,
        lastSummary: (last?.lastSummary as SyncSummary | null) ?? null,
      };
    },
    async reset(tradeId) {
      if (!createTradesRepo(db, now).clearFactsEdited(tradeId)) return null;
      return sync({ auto: false });
    },
  };
}
