import { dayTimeText } from "@tj/core";
import { Panel } from "../components/ui.js";
import { SKIP_REASON, type SyncSummary, useIbkrStatus, useIbkrSync, useIbkrSyncing } from "../ibkr.js";

const when = (at: number) => dayTimeText(at);

function ignoredLine(ignored: SyncSummary["ignored"]): string | null {
  const parts = [
    ignored.beforeStart > 0 ? `${ignored.beforeStart} fills before the start date` : null,
    ignored.stock > 0 ? `${ignored.stock} stock rows` : null,
    ignored.other > 0 ? `${ignored.other} other rows` : null,
    ignored.malformed > 0 ? `${ignored.malformed} unreadable rows` : null,
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join(", ")} ignored.` : null;
}

/** Identical skipped trades (same ticker, time and reason) as one line with a count: they have no ids of their own. */
function groupSkipped<S extends { ticker: string; openedAt: number; reason: string }>(skipped: readonly S[]) {
  const groups = new Map<string, { key: string; skip: S; count: number }>();
  for (const skip of skipped) {
    const key = `${skip.ticker}-${skip.openedAt}-${skip.reason}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { key, skip, count: 1 });
  }
  return [...groups.values()];
}

const LABEL = { paper: "Paper", live: "Live" } as const;
/** Skipped trades listed one by one; the rest are counted, so a year of Activity stays short. */
const SKIPPED_SHOWN = 5;

/** One account's last run: its line, and what it skipped, kept and ignored (spec §9.2). */
function AccountBlock({ book, summary }: { book: SyncSummary["book"]; summary: SyncSummary | null }) {
  let line: string;
  if (!summary) line = `${LABEL[book]} · Not synced yet.`;
  else if (summary.status === "error")
    line = `${LABEL[book]} · ${summary.error?.message ?? "The last sync failed."}`;
  else {
    const account = summary.account
      ? `${LABEL[summary.account.kind]} ${summary.account.externalId}`
      : LABEL[book];
    const at = summary.lastRunAt != null ? ` · last synced ${when(summary.lastRunAt)} ET` : "";
    line = `${account}${at} · ${summary.added} added, ${summary.updated} updated, ${summary.unchanged} unchanged`;
  }
  const failed = summary?.status === "error";
  const ignored = summary && !failed ? ignoredLine(summary.ignored) : null;
  const skipped = summary ? groupSkipped(summary.skipped) : [];

  return (
    <div className="flex flex-col gap-1">
      <p data-testid="ibkr-status" className={failed ? "text-down" : "text-fg"}>
        {line}
      </p>
      {summary && !failed && (
        <div className="flex flex-col gap-1 text-[11px] text-muted">
          {summary.activityFailed && (
            <p className="text-down">The Activity statement failed; today's fills are in.</p>
          )}
          {skipped.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {skipped.slice(0, SKIPPED_SHOWN).map(({ key, skip, count }) => (
                <li key={key}>
                  Skipped {skip.ticker} · {when(skip.openedAt)} — {SKIP_REASON[skip.reason]}
                  {count > 1 ? ` ×${count}` : ""}
                </li>
              ))}
              {skipped.length > SKIPPED_SHOWN && <li>… and {skipped.length - SKIPPED_SHOWN} more skipped</li>}
            </ul>
          )}
          {summary.keptEdits.length > 0 && (
            <p>
              Kept your edits on{" "}
              {summary.keptEdits.map((kept, index) => (
                <span key={kept.tradeId}>
                  {index > 0 && ", "}
                  <a href={`/trades/${kept.tradeId}`} className="text-accent">
                    {kept.ticker}
                  </a>
                </span>
              ))}
              ; IBKR has different numbers for them.
            </p>
          )}
          {ignored && <p>{ignored}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The IBKR sync on Import / Sync: each account's last run, paper first, and one button that syncs them all (spec
 * §9.2, live-sync spec §7).
 */
export function IbkrCard() {
  const status = useIbkrStatus();
  const sync = useIbkrSync();
  const syncing = useIbkrSyncing();
  const configured = status.data?.configured === true;
  const accounts = status.data?.accounts ?? [];

  return (
    <Panel title="IBKR sync">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-2">
          {!status.data && <p data-testid="ibkr-status">Loading…</p>}
          {status.data && !configured && (
            <p data-testid="ibkr-status">Not set up. Add your Flex token and query IDs in Settings.</p>
          )}
          {accounts.map((account) => (
            <AccountBlock
              key={account.book}
              book={account.book}
              summary={sync.data?.accounts.find((each) => each.book === account.book) ?? account.lastSummary}
            />
          ))}
        </div>
        <button
          type="button"
          disabled={!configured || syncing}
          onClick={() => sync.mutate(false)}
          className="rounded-sm border border-accent bg-[#2962ff1a] px-3 py-1 text-fg disabled:opacity-50"
        >
          {syncing ? "Syncing with IBKR…" : "Sync now"}
        </button>
      </div>
    </Panel>
  );
}
