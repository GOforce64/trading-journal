import { useMutation } from "@tanstack/react-query";
import { api, refusal } from "../api.js";
import { Panel } from "../components/ui.js";
import { markStopped } from "../stopped.js";

/** Settings' Journal panel (launcher spec §3.4): stop the server the icon started. No confirm: the icon starts it again. */
export function JournalPanel() {
  const stop = useMutation({
    mutationFn: async () => {
      const res = await api.api.shutdown.$post();
      if (!res.ok) throw await refusal(res, "stop");
    },
    onSuccess: markStopped,
  });
  return (
    <Panel title="Journal">
      <p className="text-[11px] text-muted">
        Opened from its icon, the journal keeps running in the background until you log out. Stop it here; the
        icon starts it again in a few seconds.
      </p>
      <button
        type="button"
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        className="mt-2 rounded-sm border border-line px-3 py-1 text-fg hover:border-down disabled:opacity-50"
      >
        Stop the journal
      </button>
      {stop.error && <p className="mt-2 text-down">{stop.error.message}</p>}
    </Panel>
  );
}
