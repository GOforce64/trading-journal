import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Panel } from "../components/ui.js";

/** What a merge did, as the server answers it (export-merge spec §4.6). */
export interface MergeSummary {
  added: number;
  updated: number;
  kept: number;
  deleted: number;
  fillsAdded: number;
  setupsAdded: number;
  tagsAdded: number;
  unchanged: boolean;
}

const BUTTON = "rounded-sm border border-line px-3 py-1 text-fg hover:border-accent";
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The line after a merge (export-merge spec §6): what it did, with zero counts left out. */
export function mergeSummaryText(file: string, summary: MergeSummary): string {
  if (summary.unchanged) return `Nothing to merge: this journal already has everything in ${file}.`;
  // The first count about trades names them; the rest read on from it.
  const trades = (
    [
      [summary.added, "added"],
      [summary.updated, "updated from the bundle"],
      [summary.kept, "kept as yours"],
      [summary.deleted, "deleted"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, what], index) => `${index === 0 ? count(n, "trade", "trades") : n} ${what}`);
  const others = (
    [
      [summary.fillsAdded, "fill", "fills"],
      [summary.setupsAdded, "setup", "setups"],
      [summary.tagsAdded, "tag", "tags"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${count(n, one, many)} added`);
  const parts = [...trades, ...others];
  return parts.length > 0 ? `Merged ${file}: ${parts.join(", ")}.` : `Merged ${file}.`;
}

/** Settings' Data panel (export-merge spec §6): where the data lives, Export journal, and Merge a bundle. */
export function DataSettings({ dataDir }: { dataDir?: string | null }) {
  const queryClient = useQueryClient();
  const merge = useMutation({
    mutationFn: async (file: File) => {
      const res = await fetch("/api/bundle/merge", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | MergeSummary | null;
      if (!res.ok) {
        throw new Error((body && "message" in body && body.message) || `Merging failed: ${res.status}`);
      }
      return { file: file.name, summary: body as MergeSummary };
    },
    // Every list, the queue and the Dashboard may have changed.
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return (
    <Panel title="Data">
      <p className="text-muted">
        Data directory <span className="num text-fg">{dataDir}</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a href="/api/bundle" download className={BUTTON}>
          Export journal
        </a>
        <label className={`${BUTTON} cursor-pointer`}>
          Merge a bundle…
          <input
            type="file"
            accept=".tjbundle"
            aria-label="Merge a bundle…"
            className="sr-only"
            disabled={merge.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // The same file can be chosen again.
              event.target.value = "";
              if (file) merge.mutate(file);
            }}
          />
        </label>
      </div>
      {merge.isPending && <p className="mt-1.5 text-muted">Merging…</p>}
      {merge.isSuccess && (
        <p className="mt-1.5 text-fg">{mergeSummaryText(merge.data.file, merge.data.summary)}</p>
      )}
      {merge.isError && <p className="mt-1.5 text-down">{merge.error.message}</p>}
    </Panel>
  );
}
