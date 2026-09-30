import { Panel } from "../components/ui.js";
import { SKIP_REASON, type SyncSummary, useIbkrStatus, useIbkrSync, useIbkrSyncing } from "../ibkr.js";

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const when = (at: number) => ET.format(new Date(at));

function ignoredLine(ignored: SyncSummary["ignored"]): string | null {
  const parts = [
    ignored.beforeStart > 0 ? `${ignored.beforeStart} fills before the start date` : null,
    ignored.stock > 0 ? `${ignored.stock} stock rows` : null,
    ignored.other > 0 ? `${ignored.other} other rows` : null,
    ignored.malformed > 0 ? `${ignored.malformed} unreadable rows` : null,
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join(", ")} ignored.` : null;
}

/** The IBKR sync on Import / Sync: what the last run did, and a button to run one (spec §9.2). */
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

export function IbkrCard() {
  const status = useIbkrStatus();
  const sync = useIbkrSync();
  const syncing = useIbkrSyncing();
  const configured = status.data?.configured === true;
  const summary = sync.data ?? status.data?.lastSummary ?? null;

  let line: string;
  if (!status.data) line = "Loading…";
  else if (!configured) line = "Not set up. Add your Flex token and query IDs in Settings.";
  else if (!summary) line = "Not synced yet.";
  else if (summary.status === "error") line = summary.error?.message ?? "The last sync failed.";
  else {
    const account = summary.account
      ? `${summary.account.kind === "paper" ? "Paper" : "Live"} ${summary.account.externalId}`
      : "IBKR";
    const at = summary.lastRunAt != null ? ` · last synced ${when(summary.lastRunAt)} ET` : "";
    line = `${account}${at} · ${summary.added} added, ${summary.updated} updated, ${summary.unchanged} unchanged`;
  }
  const failed = summary?.status === "error";
  const ignored = summary && !failed ? ignoredLine(summary.ignored) : null;

  return (
    <Panel title="IBKR · paper sync">
      <div className="flex flex-wrap items-center gap-3">
        <p data-testid="ibkr-status" className={failed ? "text-down" : "text-fg"}>
          {line}
        </p>
        <button
          type="button"
          disabled={!configured || syncing}
          onClick={() => sync.mutate(false)}
          className="rounded-sm border border-accent bg-[#2962ff1a] px-3 py-1 text-fg disabled:opacity-50"
        >
          {syncing ? "Syncing with IBKR…" : "Sync now"}
        </button>
      </div>
      {summary && !failed && (
        <div className="mt-2 flex flex-col gap-1 text-[11px] text-muted">
          {summary.activityFailed && (
            <p className="text-down">The Activity statement failed; today's fills are in.</p>
          )}
          {summary.skipped.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {groupSkipped(summary.skipped).map(({ key, skip, count }) => (
                <li key={key}>
                  Skipped {skip.ticker} · {when(skip.openedAt)} — {SKIP_REASON[skip.reason]}
                  {count > 1 ? ` ×${count}` : ""}
                </li>
              ))}
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
    </Panel>
  );
}
