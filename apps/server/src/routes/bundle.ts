import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  BUNDLE_KEYS,
  BUNDLE_TABLES,
  type Bundle,
  type BundleTable,
  type Db,
  exportBundle,
  type IncomingBundle,
  mergeBundle,
  schemaVersion,
} from "@tj/db";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { FILE_NAME, sha256, storeFile } from "./attachments.js";

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
  // A table added since format 1 (attachments) may be missing from an older bundle: its trades keep their own.
  tables: z.object(
    Object.fromEntries(
      BUNDLE_TABLES.map((table) => [table, table === "attachments" ? rows(table).optional() : rows(table)]),
    ),
  ),
  files: z.record(z.string(), z.string()).optional(),
});

/** The bundle a file's bytes hold, or null when they aren't one: not gzip, not JSON, or the wrong shape. */
function readBundle(bytes: Uint8Array): IncomingBundle | null {
  try {
    const parsed = bundleSchema.safeParse(JSON.parse(gunzipSync(bytes).toString("utf8")));
    return parsed.success ? (parsed.data as IncomingBundle) : null;
  } catch {
    return null;
  }
}

/** The bundle's screenshot files (screenshots spec §4): those live rows use, from the attachments directory. */
function filesOf(bundle: Bundle, dir: string | undefined): Record<string, string> | undefined {
  if (!dir) return undefined;
  const files: Record<string, string> = {};
  for (const row of bundle.tables.attachments) {
    const name = `${row.sha256}.${row.ext}`;
    const path = join(dir, name);
    if (row.deleted_at == null && FILE_NAME.test(name) && existsSync(path)) {
      files[name] = readFileSync(path).toString("base64");
    }
  }
  return files;
}

/** The bundle's files as bytes, or null when a name isn't a stored file's or the content doesn't match it. */
function checkedFiles(files: Record<string, string> | undefined): Map<string, Uint8Array> | null {
  const checked = new Map<string, Uint8Array>();
  for (const [name, base64] of Object.entries(files ?? {})) {
    const match = FILE_NAME.exec(name);
    const bytes = new Uint8Array(Buffer.from(base64, "base64"));
    if (!match || sha256(bytes) !== match[1]) return null;
    checked.set(name, bytes);
  }
  return checked;
}

/** Export and merge between machines (export-merge spec §5), with the screenshots' files (screenshots spec §4). */
export function bundleRoutes(
  db: Db,
  {
    backup,
    now = Date.now,
    host = hostname,
    dir,
  }: { backup?: () => string; now?: () => number; host?: () => string; dir?: string } = {},
) {
  return new Hono()
    .get("/", (c) => {
      const machine = machineName(host());
      const at = now();
      const bundle = exportBundle(db, { machine, now: () => at });
      const files = filesOf(bundle, dir);
      const body = gzipSync(JSON.stringify(files ? { ...bundle, files } : bundle));
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
        const files = checkedFiles(bundle.files);
        if (!files) return c.json(INVALID, 400);
        backup?.();
        // Files before rows: a merged screenshot never points at a missing file.
        if (dir) for (const [name, bytes] of files) storeFile(dir, name, bytes);
        return c.json(mergeBundle(db, bundle), 200);
      },
    );
}
