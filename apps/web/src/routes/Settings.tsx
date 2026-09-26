import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api.js";
import { Panel } from "../components/ui.js";

/** Everything that shows market data, refetched once a key changes. */
const MARKET_QUERIES = ["settings", "quotes", "option-quotes", "chain", "company"];

const FIELD = "flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider";
const INPUT =
  "num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg normal-case tracking-normal outline-none focus:border-accent";

/** The server explains a refusal in `message`; fall back to the status. */
async function refusal(res: { status: number; json(): Promise<unknown> }, action: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(body.message ?? `${action} failed: ${res.status}`);
}

export function Settings({
  confirm = (text: string) => window.confirm(text),
}: {
  confirm?: (text: string) => boolean;
}) {
  const queryClient = useQueryClient();
  const [keyId, setKeyId] = useState("");
  const [secretKey, setSecretKey] = useState("");

  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await api.api.settings.$get();
      if (!res.ok) throw new Error(`settings failed: ${res.status}`);
      return res.json();
    },
  });

  const refresh = () =>
    Promise.all(MARKET_QUERIES.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.api.settings["market-data"].$put({ json: { keyId, secretKey } });
      if (!res.ok) throw await refusal(res, "save");
    },
    onSuccess: async () => {
      setKeyId("");
      setSecretKey("");
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await api.api.settings["market-data"].$delete();
      if (!res.ok) throw await refusal(res, "remove");
    },
    onSuccess: refresh,
  });

  const market = data?.marketData;
  const status = !market
    ? "Loading…"
    : market.state === "on"
      ? `Connected · key ${market.keyIdHint} · paper account`
      : market.state === "error"
        ? (market.message ?? "Alpaca rejected the saved key.")
        : "Not set up: live prices, chains and marks are off";
  const dot = market?.state === "on" ? "bg-up" : market?.state === "error" ? "bg-down" : "bg-muted";

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <Panel title="Market data · Alpaca">
        <p className="mb-2 flex items-center gap-2 rounded-sm border border-line bg-[#0e1118] px-2 py-1">
          <span className={`inline-block size-2 rounded-full ${dot}`} />
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
            Key ID
            <input
              aria-label="Key ID"
              value={keyId}
              onChange={(event) => setKeyId(event.target.value)}
              placeholder={market?.keyIdHint ? `${market.keyIdHint} (saved)` : "PK…"}
              autoComplete="off"
              className={INPUT}
            />
          </label>
          <label className={FIELD}>
            Secret key
            <input
              aria-label="Secret key"
              type="password"
              value={secretKey}
              onChange={(event) => setSecretKey(event.target.value)}
              placeholder={market?.keyIdHint ? "saved, never shown" : ""}
              autoComplete="new-password"
              className={INPUT}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={save.isPending || !keyId.trim() || !secretKey.trim()}
              className="rounded-sm bg-accent px-3 py-1.5 text-white disabled:opacity-50"
            >
              {save.isPending ? "Testing…" : "Save and test"}
            </button>
            {market?.keyIdHint && (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Remove the Alpaca key? Live prices, chains and marks will stop."))
                    remove.mutate();
                }}
                className="rounded-sm border border-line px-3 py-1.5 text-fg hover:border-accent"
              >
                Remove key
              </button>
            )}
          </div>
        </form>
        {save.error && <p className="mt-2 text-down">{save.error.message}</p>}
        {remove.error && <p className="mt-2 text-down">{remove.error.message}</p>}
        <p className="mt-3 text-[11px] text-muted">
          Use your <strong>Paper</strong> account's API keys: they're free and need no funding. The key is
          kept in secrets.json in the data directory below, readable only by you, and never in the repository
          or an export. It powers live prices, option chains and marks.
        </p>
      </Panel>
      <Panel title="Data">
        <p className="text-muted">
          Data directory <span className="num text-fg">{data?.dataDir}</span>
        </p>
      </Panel>
    </div>
  );
}
