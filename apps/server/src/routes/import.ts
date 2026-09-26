import { zValidator } from "@hono/zod-validator";
import { createTradesRepo, type Db } from "@tj/db";
import {
  OquantsFormatError,
  type OquantsPayload,
  oquantsPayloadSchema,
  type ParsedTrade,
  parseOquants,
} from "@tj/importers";
import { Hono } from "hono";

export interface PreviewRow {
  status: "new" | "existing" | "skipped";
  ticker: string;
  structure: string;
  openedAt: number | null;
  closedAt: number | null;
  netPnl: number | null;
  flags: string[];
  reason: string | null;
}

const ORDER = { new: 0, existing: 1, skipped: 2 } as const;

/**
 * Insert-only: a trade already in the journal is never touched, so re-running
 * the import after more trades land in oQuants only adds the new ones.
 */
export function importRoutes(db: Db, backup?: () => string, now?: () => number) {
  const repo = createTradesRepo(db, now);

  function plan(payload: OquantsPayload) {
    const { rows, warnings } = parseOquants(payload);
    const parsed = rows.filter((row): row is ParsedTrade => row.kind === "trade");
    const existing = repo.existingIds(parsed.map((row) => row.id));
    const preview: PreviewRow[] = rows
      .map((row): PreviewRow => {
        if (row.kind === "skip") {
          return {
            status: "skipped",
            ticker: row.ticker,
            structure: row.structure,
            openedAt: null,
            closedAt: null,
            netPnl: null,
            flags: [],
            reason: row.reason,
          };
        }
        const already = existing.has(row.id);
        return {
          status: already ? "existing" : "new",
          ticker: row.trade.underlying,
          structure: row.trade.structureLabel ?? "",
          openedAt: row.trade.openedAt,
          closedAt: row.trade.closedAt,
          netPnl: row.trade.netPnl,
          flags: row.flags,
          reason: already ? "already imported" : null,
        };
      })
      .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    const counts = {
      new: preview.filter((row) => row.status === "new").length,
      existing: preview.filter((row) => row.status === "existing").length,
      skipped: preview.filter((row) => row.status === "skipped").length,
    };
    return { warnings, counts, preview, fresh: parsed.filter((row) => !existing.has(row.id)) };
  }

  return new Hono()
    .post("/oquants/preview", zValidator("json", oquantsPayloadSchema), (c) => {
      try {
        const { warnings, counts, preview } = plan(c.req.valid("json"));
        return c.json({ warnings, counts, rows: preview }, 200);
      } catch (error) {
        if (error instanceof OquantsFormatError) return c.json({ error: error.message }, 422);
        throw error;
      }
    })
    .post("/oquants/commit", zValidator("json", oquantsPayloadSchema), (c) => {
      try {
        // Planned again rather than trusting the preview, so a stale page cannot insert twice.
        const { fresh } = plan(c.req.valid("json"));
        if (fresh.length === 0) return c.json({ imported: 0, backupFile: null as string | null }, 200);
        const backupFile = backup ? backup() : null;
        const imported = repo.importMany(
          fresh.map((row) => ({ id: row.id, trade: row.trade })),
          crypto.randomUUID(),
        );
        return c.json({ imported, backupFile }, 200);
      } catch (error) {
        if (error instanceof OquantsFormatError) return c.json({ error: error.message }, 422);
        throw error;
      }
    });
}
