import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, refusal } from "../api.js";
import { Panel } from "../components/ui.js";
import { todayNy } from "../market.js";

export interface IbkrView {
  configured: boolean;
  tokenHint: string | null;
  activityQueryId: string | null;
  todayQueryId: string | null;
  since: string | null;
}

const FIELD = "flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider";
const INPUT =
  "num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg normal-case tracking-normal outline-none placeholder:text-[#4a5163] placeholder:italic focus:border-accent";

/** The IBKR Flex Web Service: token, the two queries, and the date the sync starts from (spec §9.4). */
export function IbkrSettings({ ibkr, confirm }: { ibkr: IbkrView; confirm: (text: string) => boolean }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [activityQueryId, setActivity] = useState(ibkr.activityQueryId ?? "");
  const [todayQueryId, setToday] = useState(ibkr.todayQueryId ?? "");
  const [since, setSince] = useState(ibkr.since ?? todayNy());

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["settings"] }),
      queryClient.invalidateQueries({ queryKey: ["ibkr-status"] }),
    ]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.api.settings.ibkr.$put({
        json: { token: token.trim() || undefined, activityQueryId, todayQueryId, since },
      });
      if (!res.ok) throw await refusal(res, "save");
    },
    onSuccess: async () => {
      setToken("");
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await api.api.settings.ibkr.$delete();
      if (!res.ok) throw await refusal(res, "remove");
    },
    onSuccess: refresh,
  });

  const status = ibkr.configured
    ? `Set up · token ${ibkr.tokenHint} · Activity ${ibkr.activityQueryId} · Today ${ibkr.todayQueryId} · from ${ibkr.since}`
    : "Not set up: scalps and flies from IBKR won't sync";
  const problem = save.error ?? remove.error;

  return (
    <Panel title="IBKR Flex">
      <p className="mb-2 flex items-center gap-2 rounded-sm border border-line bg-[#0e1118] px-2 py-1">
        <span className={`inline-block size-2 rounded-full ${ibkr.configured ? "bg-up" : "bg-muted"}`} />
        <span>{status}</span>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
        className="flex flex-col gap-2"
      >
        <label className={FIELD}>
          Flex token
          <input
            aria-label="Flex token"
            type="password"
            autoComplete="off"
            value={token}
            placeholder={ibkr.configured ? "saved; leave blank to keep it" : ""}
            onChange={(event) => setToken(event.target.value)}
            className={INPUT}
          />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className={FIELD}>
            Activity query ID
            <input
              aria-label="Activity query ID"
              value={activityQueryId}
              onChange={(event) => setActivity(event.target.value)}
              className={INPUT}
            />
          </label>
          <label className={FIELD}>
            Today query ID
            <input
              aria-label="Today query ID"
              value={todayQueryId}
              onChange={(event) => setToday(event.target.value)}
              className={INPUT}
            />
          </label>
          <label className={FIELD}>
            Start date
            <input
              aria-label="Start date"
              type="date"
              value={since}
              onChange={(event) => setSince(event.target.value)}
              className={INPUT}
            />
          </label>
        </div>
        <p className="text-[10px] text-muted">
          In Client Portal, Performance &amp; Reports → Flex Queries shows each query's ID, and Settings →
          Account Settings → Flex Web Service gives the token.
        </p>
        <p className="text-[10px] text-muted">Both machines need the same start date.</p>
        <div className="flex gap-2">
          <button
            type="submit"
            aria-label="Save IBKR"
            disabled={save.isPending}
            className="rounded-sm bg-accent px-3 py-1 text-white disabled:opacity-50"
          >
            {save.isPending ? "Testing with IBKR…" : "Save"}
          </button>
          {ibkr.configured && (
            <button
              type="button"
              aria-label="Remove IBKR"
              onClick={() => {
                if (confirm("Remove the IBKR token and queries from this machine?")) remove.mutate();
              }}
              className="rounded-sm border border-line px-3 py-1 text-fg hover:border-accent"
            >
              Remove
            </button>
          )}
        </div>
        {problem && <p className="text-down">{problem.message}</p>}
      </form>
    </Panel>
  );
}
