import { hostname } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  BUNDLE_KEYS,
  BUNDLE_TABLES,
  type Bundle,
  type BundleTable,
  type Db,
  exportBundle,
  mergeBundle,
  schemaVersion,
} from "@tj/db";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

const INVALID = { error: "invalid", message: "This isn't a journal bundle." };
/** Years of fills, at about 1 KB each with their raw JSON (export-merge spec §7). */
const MAX_BYTES = 100 * 1024 * 1024;

/** This computer's name as a file name takes it: "DESKTOP-4K2L.local" becomes "desktop-4k2l-local". */
export const machineName = (host: string): string =>
  host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "journal";

const pad = (value: number) => String(value).padStart(2, "0");

/** `journal-{machine}-{YYYY-MM-DD-HHmm}.tjbundle`, in local time (export-merge spec §3). */
export const bundleFileName = (machine: string, at: Date): string =>
  `journal-${machine}-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.tjbundle`;

const cell = z.union([z.string(), z.number(), z.null()]);
const rows = (table: BundleTable) =>
  z
    .array(z.record(z.string(), cell))
    // A row without its key couldn't be matched to anything.
    .refine((list) => list.every((row) => BUNDLE_KEYS[table].every((key) => row[key] != null)));
const bundleSchema = z.object({
  manifest: z.object({
    format: z.literal(1),
    schema: z.number().int().nonnegative(),
    machine: z.string(),
    exportedAt: z.number(),
    counts: z.record(z.string(), z.number()),
  }),
  tables: z.object(Object.fromEntries(BUNDLE_TABLES.map((table) => [table, rows(table)]))),
});

/** The bundle a file's bytes hold, or null when they aren't one: not gzip, not JSON, or the wrong shape. */
function readBundle(bytes: Uint8Array): Bundle | null {
  try {
    const parsed = bundleSchema.safeParse(JSON.parse(gunzipSync(bytes).toString("utf8")));
    return parsed.success ? (parsed.data as Bundle) : null;
  } catch {
    return null;
  }
}

/** Export and merge between machines (export-merge spec §5). */
export function bundleRoutes(
  db: Db,
  {
    backup,
    now = Date.now,
    host = hostname,
  }: { backup?: () => string; now?: () => number; host?: () => string } = {},
) {
  return new Hono()
    .get("/", (c) => {
      const machine = machineName(host());
      const at = now();
      const body = gzipSync(JSON.stringify(exportBundle(db, { machine, now: () => at })));
      return c.body(new Uint8Array(body), 200, {
        "content-type": "application/gzip",
        "content-disposition": `attachment; filename="${bundleFileName(machine, new Date(at))}"`,
      });
    })
    .post(
      "/merge",
      bodyLimit({
        maxSize: MAX_BYTES,
        onError: (c) => c.json({ error: "too_large", message: "That file is over 100 MB." }, 413),
      }),
      async (c) => {
        const bundle = readBundle(new Uint8Array(await c.req.arrayBuffer()));
        if (!bundle) return c.json(INVALID, 400);
        const mine = schemaVersion(db);
        if (bundle.manifest.schema > mine) {
          return c.json(
            {
              error: "newer",
              message: `This bundle comes from a newer version of the journal (schema ${bundle.manifest.schema}; this one is ${mine}). Update this machine first.`,
            },
            409,
          );
        }
        backup?.();
        return c.json(mergeBundle(db, bundle), 200);
      },
    );
}
