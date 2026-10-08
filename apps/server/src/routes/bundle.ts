import { existsSync, readFileSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
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
import { z } from "zod";
import { ArchiveError, type Entry, tarChunks, tarEntries } from "../archive.js";
import { commitFile, FILE_NAME, MAX_IMAGE_BYTES, sha256, stageFile } from "./attachments.js";

const INVALID = { error: "invalid", message: "This isn't a journal bundle." };
/** Years of fills, at about 1 KB each with their raw JSON (export-merge spec §7): the cap on a bundle's tables. */
const MAX_BYTES = 100 * 1024 * 1024;
/** A bundle's entries (screenshots spec §4): its tables first, then each screenshot's file. */
const TABLES = "bundle.json.gz";
const FILES = "attachments/";

/** What makes a bundle refused: not one, or its tables too big. */
class Refused extends Error {
  constructor(readonly status: 400 | 413) {
    super("refused");
  }
}

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
});

/** The tables a bundle's gzipped JSON holds, or null when it isn't one: not gzip, not JSON, or the wrong shape. */
function readTables(gzipped: Uint8Array): IncomingBundle | null {
  try {
    const parsed = bundleSchema.safeParse(JSON.parse(gunzipSync(gzipped).toString("utf8")));
    return parsed.success ? (parsed.data as IncomingBundle) : null;
  } catch {
    return null;
  }
}

/**
 * The screenshot files live rows use, each once, read one at a time as the archive is written. A file whose content
 * no longer matches its name is left out: the other machine would refuse the whole bundle for it.
 */
function* filesOf(bundle: Bundle, dir: string): Generator<Entry> {
  const names = new Set(
    bundle.tables.attachments
      .filter((row) => row.deleted_at == null)
      .map((row) => `${row.sha256}.${row.ext}`)
      .filter((name) => FILE_NAME.test(name)),
  );
  for (const name of names) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const bytes = new Uint8Array(readFileSync(path));
    if (sha256(bytes) === FILE_NAME.exec(name)?.[1]) yield { name: `${FILES}${name}`, bytes };
  }
}

/** Everything a request body holds, up to `limit` bytes. */
async function collect(chunks: AsyncIterable<Uint8Array>, limit: number): Promise<Uint8Array> {
  const all: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of chunks) {
    size += chunk.length;
    if (size > limit) throw new Refused(413);
    all.push(chunk);
  }
  return new Uint8Array(Buffer.concat(all));
}

/**
 * A request body's chunks, with the first one put back after a look at its first byte, and a way to read the rest to
 * its end: a reply sent with an upload half-read can reach the browser as a broken connection instead.
 */
async function opening(body: ReadableStream<Uint8Array>) {
  const source = Readable.fromWeb(body as NodeReadableStream<Uint8Array>)[Symbol.asyncIterator]();
  const drain = async () => {
    while (!(await source.next()).done) {}
  };
  let first: Uint8Array = new Uint8Array(0);
  while (first.length === 0) {
    const next = await source.next();
    if (next.done) return null;
    first = next.value;
  }
  const head = first;
  // Leaving this early doesn't close `source`, so `drain` can still read what's left.
  async function* chunks() {
    yield head;
    for (let next = await source.next(); !next.done; next = await source.next()) yield next.value;
  }
  return { gzip: head[0] === 0x1f, chunks: chunks(), drain };
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
      function* entries(): Generator<Entry> {
        yield { name: TABLES, bytes: new Uint8Array(gzipSync(JSON.stringify(bundle))) };
        if (dir) yield* filesOf(bundle, dir);
      }
      const stream = Readable.toWeb(Readable.from(tarChunks(entries(), at)));
      return c.body(stream as unknown as ReadableStream<Uint8Array>, 200, {
        "content-type": "application/x-tar",
        "content-disposition": `attachment; filename="${bundleFileName(machine, new Date(at))}"`,
      });
    })
    .post("/merge", async (c) => {
      // Files are staged as they arrive, and only put in place once the whole bundle has been read and backed up.
      const staged = new Map<string, string>();
      let body: Awaited<ReturnType<typeof opening>> = null;
      try {
        body = c.req.raw.body && (await opening(c.req.raw.body));
        if (!body) throw new Refused(400);
        let bundle: IncomingBundle | null = null;
        if (body.gzip) {
          // A bundle from before screenshots: its tables alone, gzipped.
          bundle = readTables(await collect(body.chunks, MAX_BYTES));
          if (!bundle) throw new Refused(400);
        } else {
          const wanted = (name: string, size: number) => {
            if (name === TABLES) {
              if (bundle) throw new Refused(400);
              if (size > MAX_BYTES) throw new Refused(413);
              return true;
            }
            if (!name.startsWith(FILES)) return false;
            // The tables come first, and a file is a screenshot by its name and size or the bundle isn't one.
            if (!bundle || !FILE_NAME.test(name.slice(FILES.length)) || size > MAX_IMAGE_BYTES) {
              throw new Refused(400);
            }
            return true;
          };
          for await (const entry of tarEntries(body.chunks, wanted)) {
            if (entry.name === TABLES) {
              bundle = readTables(entry.bytes);
              if (!bundle) throw new Refused(400);
              // Refused before any file is read: the rest of the upload is only drained.
              const newer = newerThanMine(bundle);
              if (newer) return c.json(newer, 409);
              continue;
            }
            const name = entry.name.slice(FILES.length);
            if (sha256(entry.bytes) !== FILE_NAME.exec(name)?.[1]) throw new Refused(400);
            if (dir && !staged.has(name)) staged.set(name, stageFile(dir, name, entry.bytes));
          }
          if (!bundle) throw new Refused(400);
        }
        const newer = newerThanMine(bundle);
        if (newer) return c.json(newer, 409);
        backup?.();
        // Files before rows: a merged screenshot never points at a missing file.
        if (dir) for (const [name, temp] of staged) commitFile(dir, name, temp);
        staged.clear();
        return c.json(mergeBundle(db, bundle), 200);
      } catch (error) {
        if (error instanceof ArchiveError || (error instanceof Refused && error.status === 400)) {
          return c.json(INVALID, 400);
        }
        if (error instanceof Refused) {
          return c.json({ error: "too_large", message: "That bundle's trades come to over 100 MB." }, 413);
        }
        throw error;
      } finally {
        for (const temp of staged.values()) rmSync(temp, { force: true });
        // A client that went away has nothing left to send.
        await body?.drain().catch(() => {});
      }
    });

  /** The refusal for a bundle from a newer schema than this journal's, or null. */
  function newerThanMine(bundle: IncomingBundle) {
    const mine = schemaVersion(db);
    if (bundle.manifest.schema <= mine) return null;
    return {
      error: "newer",
      message: `This bundle comes from a newer version of the journal (schema ${bundle.manifest.schema}; this one is ${mine}). Update this machine first.`,
    };
  }
}
