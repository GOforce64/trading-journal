import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api.js";
import { Money, Panel } from "../components/ui.js";

interface PreviewRow {
  status: "new" | "existing" | "skipped";
  ticker: string;
  structure: string;
  openedAt: number | null;
  closedAt: number | null;
  netPnl: number | null;
  flags: string[];
  reason: string | null;
}

interface Preview {
  warnings: string[];
  counts: { new: number; existing: number; skipped: number };
  rows: PreviewRow[];
}

interface CommitResult {
  imported: number;
  backupFile: string | null;
}

const NOT_AN_EXPORT =
  "That isn't the snippet's output. Run the snippet on oQuants again and paste what it copied.";

const when = (epochMs: number | null) =>
  epochMs == null
    ? "—"
    : new Date(epochMs).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

const STATUS_LABEL = { new: "NEW", existing: "HAVE", skipped: "SKIP" } as const;

async function send(step: "preview" | "commit", payload: unknown): Promise<unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: the server validates the pasted payload
  const json = payload as any;
  const res =
    step === "preview"
      ? await api.api.import.oquants.preview.$post({ json })
      : await api.api.import.oquants.commit.$post({ json });
  const body: unknown = await res.json();
  if (res.ok) return body;
  // The RPC types omit the validator's 400, so widen the status before comparing.
  const status: number = res.status;
  if (status === 400) throw new Error(NOT_AN_EXPORT);
  throw new Error((body as { error?: string }).error ?? `Import failed (${status}).`);
}

export function Import({ onDone }: { onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  const previewStep = useMutation({
    mutationFn: (payload: unknown) => send("preview", payload) as Promise<Preview>,
    onSuccess: (data) => {
      setPreview(data);
      setResult(null);
    },
    onError: (error) => setProblem(error.message),
  });

  const commitStep = useMutation({
    mutationFn: (payload: unknown) => send("commit", payload) as Promise<CommitResult>,
    onSuccess: (data) => {
      setResult(data);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["trades"] });
    },
    onError: (error) => setProblem(error.message),
  });

  function run(mutate: (payload: unknown) => void) {
    setProblem(null);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      setProblem(NOT_AN_EXPORT);
      return;
    }
    mutate(payload);
  }

  const busy = previewStep.isPending || commitStep.isPending;

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Import / Sync — oQuants">
        <p className="mb-2 text-muted">
          On oQuants → Portfolio, open DevTools (F12) → Console, paste <code>scripts/oquants-extract.js</code>{" "}
          and press Enter. It copies the table; paste it here.
        </p>
        <textarea
          aria-label="Snippet output"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="num min-h-24 w-full rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[12px] text-fg outline-none focus:border-accent"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => run(previewStep.mutate)}
            disabled={busy}
            className="rounded-sm border border-line px-3 py-1.5 text-fg disabled:opacity-50"
          >
            Preview
          </button>
          {preview && (
            <button
              type="button"
              onClick={() => run(commitStep.mutate)}
              disabled={busy || preview.counts.new === 0}
              className="rounded-sm bg-accent px-3 py-1.5 text-white disabled:opacity-50"
            >
              Import {preview.counts.new}
            </button>
          )}
        </div>
        {problem && <p className="mt-2 text-down">{problem}</p>}
        {result && (
          <p className="mt-2 text-up">
            {result.imported} trade{result.imported === 1 ? "" : "s"} imported
            {result.backupFile ? ` · backup saved as ${result.backupFile}` : ""}
            {onDone && (
              <button type="button" onClick={onDone} className="ml-2 text-accent underline">
                Open Iron Flies
              </button>
            )}
          </p>
        )}
      </Panel>

      {preview && (
        <Panel title="Preview">
          {preview.warnings.map((warning) => (
            <p key={warning} className="mb-1 text-down">
              ⚠ {warning}
            </p>
          ))}
          <p className="mb-2 text-muted">
            NEW {preview.counts.new} · ALREADY IMPORTED {preview.counts.existing} · SKIPPED{" "}
            {preview.counts.skipped}
          </p>
          <table className="w-full border-collapse text-[11px]">
            <thead className="text-[9px] text-muted uppercase tracking-wider">
              <tr>
                <th className="py-1 text-left font-medium" />
                <th className="text-left font-medium">Ticker</th>
                <th className="text-left font-medium">Structure</th>
                <th className="text-left font-medium">Opened (ET)</th>
                <th className="text-left font-medium">Closed (ET)</th>
                <th className="text-right font-medium">Net P&amp;L</th>
                <th className="pl-3 text-left font-medium">Flags / reason</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, index) => (
                // Rows have no id of their own; the list never reorders while shown.
                // biome-ignore lint/suspicious/noArrayIndexKey: static list
                <tr key={index} className="border-line border-t">
                  <td className="py-1 text-muted">{STATUS_LABEL[row.status]}</td>
                  <td>{row.ticker}</td>
                  <td>{row.structure}</td>
                  <td className="num">{when(row.openedAt)}</td>
                  <td className="num">{when(row.closedAt)}</td>
                  <td className="text-right">
                    <Money value={row.netPnl} />
                  </td>
                  <td className="pl-3 text-muted">
                    {[...row.flags, row.reason].filter(Boolean).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
