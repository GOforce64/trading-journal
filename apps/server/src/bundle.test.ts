import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { type Entry, tarChunks, tarEntries } from "./archive.js";
import { bundleFileName, machineName } from "./routes/bundle.js";
import { LOCAL, testApp } from "./testing.js";

const JSON_HEADERS = { "content-type": "application/json", ...LOCAL };

/** The Sep 28 NVDA 232.5C scalp as POST /api/trades takes it. */
const SCALP = {
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  structureLabel: "Long call",
  openedAt: Date.UTC(2026, 8, 28, 13, 31, 5),
  closedAt: Date.UTC(2026, 8, 28, 13, 46, 12),
  netPnl: 44.74,
  fees: 2.26,
  legs: [
    { right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2, openPrice: 1.06, closePrice: 1.295 },
  ],
};

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 9]);
const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** One machine's app, with a recorded merge backup. */
function machine() {
  const mergeBackup = vi.fn(() => "/backups/journal-merge-1.db");
  const dir = mkdtempSync(join(tmpdir(), "tj-shots-"));
  const app = testApp({ mergeBackup, attachmentsDir: dir });
  return {
    app,
    dir,
    mergeBackup,
    async attach(tradeId: string, bytes: Uint8Array) {
      const res = await app.request(`/api/trades/${tradeId}/attachments`, {
        method: "POST",
        headers: { ...LOCAL, "content-type": "image/png" },
        body: bytes,
      });
      return (await res.json()) as { sha256: string };
    },
    async create() {
      const res = await app.request("/api/trades", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(SCALP),
      });
      return ((await res.json()) as { id: string }).id;
    },
    async exported() {
      const res = await app.request("/api/bundle", { headers: LOCAL });
      return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
    },
    async merge(body: Uint8Array | string) {
      const res = await app.request("/api/bundle/merge", {
        method: "POST",
        headers: { ...LOCAL, "content-type": "application/octet-stream" },
        body,
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
  };
}

const gzipJson = (value: unknown) => new Uint8Array(gzipSync(JSON.stringify(value)));

async function archive(entries: Entry[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of tarChunks(entries, 0)) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

async function entriesOf(bytes: Uint8Array): Promise<Entry[]> {
  const entries: Entry[] = [];
  async function* once() {
    yield bytes;
  }
  for await (const entry of tarEntries(once(), () => true)) entries.push(entry);
  return entries;
}

const TABLES = "bundle.json.gz";
interface Tables {
  manifest: { format: number; schema: number };
  tables: Record<string, Record<string, unknown>[]>;
}
/** The tables an exported bundle carries. */
async function tablesOf(bytes: Uint8Array): Promise<Tables> {
  const entry = (await entriesOf(bytes)).find((each) => each.name === TABLES);
  return JSON.parse(gunzipSync(entry?.bytes ?? new Uint8Array(0)).toString("utf8"));
}
/** The bundle with its tables changed by `edit` and its files as they were, or as `files` gives them. */
async function rewritten(bytes: Uint8Array, edit: (tables: Tables) => void, files?: Entry[]) {
  const tables = await tablesOf(bytes);
  edit(tables);
  const kept = files ?? (await entriesOf(bytes)).filter((entry) => entry.name !== TABLES);
  return archive([{ name: TABLES, bytes: gzipJson(tables) }, ...kept]);
}

describe("bundle names", () => {
  it("names a file by the machine and the local time, to the minute", () => {
    expect(bundleFileName("fedora", new Date(2026, 9, 8, 9, 12))).toBe(
      "journal-fedora-2026-10-08-0912.tjbundle",
    );
    expect(machineName("DESKTOP-4K2L.local")).toBe("desktop-4k2l-local");
    expect(machineName("···")).toBe("journal");
  });
});

describe("GET /api/bundle", () => {
  it("downloads the journal as an archive named for this machine: its tables, then each screenshot's file once", async () => {
    const a = machine();
    const id = await a.create();
    const { sha256 } = await a.attach(id, PNG);
    await a.attach(id, PNG);
    const { res, bytes } = await a.exported();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-tar");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="journal-[a-z0-9-]+-\d{4}-\d{2}-\d{2}-\d{4}\.tjbundle"$/,
    );
    const entries = await entriesOf(bytes);
    expect(entries.map((entry) => entry.name)).toEqual([TABLES, `attachments/${sha256}.png`]);
    expect(entries[1]?.bytes).toEqual(PNG);
    const tables = await tablesOf(bytes);
    expect(tables.manifest.format).toBe(1);
    expect(tables.tables.trades?.map((row) => row.id)).toEqual([id]);
    expect(tables.tables.attachments).toHaveLength(2);
  });

  it("leaves out a file whose content no longer matches its name, rather than spoil the bundle", async () => {
    const a = machine();
    const b = machine();
    const { sha256 } = await a.attach(await a.create(), PNG);
    writeFileSync(join(a.dir, `${sha256}.png`), "damaged");
    const { bytes } = await a.exported();
    expect((await entriesOf(bytes)).map((entry) => entry.name)).toEqual([TABLES]);
    expect(await b.merge(bytes)).toMatchObject({ status: 200, body: { added: 1 } });
  });
});

describe("POST /api/bundle/merge", () => {
  it("merges another machine's bundle after a backup, and nothing the second time", async () => {
    const a = machine();
    const b = machine();
    const id = await a.create();
    const { bytes } = await a.exported();
    expect(await b.merge(bytes)).toMatchObject({ status: 200, body: { added: 1, unchanged: false } });
    expect(b.mergeBackup).toHaveBeenCalledTimes(1);
    expect((await b.app.request(`/api/trades/${id}`, { headers: LOCAL })).status).toBe(200);
    expect(await b.merge(bytes)).toMatchObject({ status: 200, body: { added: 0, unchanged: true } });
  });

  it("refuses anything that isn't a bundle, writing nothing and backing nothing up", async () => {
    const b = machine();
    const tables = await tablesOf((await machine().exported()).bytes);
    for (const body of [
      "",
      "not a bundle",
      gzipJson("{"),
      gzipJson({}),
      gzipJson({ manifest: { format: 2 }, tables: {} }),
      new Uint8Array(gzipSync("{")),
      await archive([]),
      await archive([{ name: TABLES, bytes: gzipJson({}) }]),
      // The tables come first: a file before them has nothing to belong to yet.
      await archive([
        { name: `attachments/${"a".repeat(64)}.png`, bytes: PNG },
        { name: TABLES, bytes: gzipJson(tables) },
      ]),
      (await archive([{ name: TABLES, bytes: gzipJson(tables) }])).subarray(0, 700),
    ]) {
      expect(await b.merge(body)).toEqual({
        status: 400,
        body: { error: "invalid", message: "This isn't a journal bundle." },
      });
    }
    expect(b.mergeBackup).not.toHaveBeenCalled();
    expect(readdirSync(b.dir)).toEqual([]);
  });

  it("refuses a bundle from a newer version of the journal", async () => {
    const a = machine();
    const b = machine();
    await a.create();
    const exported = (await a.exported()).bytes;
    const mine = (await tablesOf(exported)).manifest.schema;
    const newer = await rewritten(exported, (tables) => {
      tables.manifest.schema = mine + 1;
    });
    expect(await b.merge(newer)).toEqual({
      status: 409,
      body: {
        error: "newer",
        message: `This bundle comes from a newer version of the journal (schema ${mine + 1}; this one is ${mine}). Update this machine first.`,
      },
    });
    expect(b.mergeBackup).not.toHaveBeenCalled();
  });
});

describe("POST /api/bundle/merge, reading the whole upload", () => {
  /** A request body that counts how much of itself was read. */
  function counted(bytes: Uint8Array) {
    let read = 0;
    let at = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= bytes.length) return controller.close();
        const chunk = bytes.subarray(at, at + 64 * 1024);
        at += chunk.length;
        read += chunk.length;
        controller.enqueue(chunk);
      },
    });
    return { stream, read: () => read };
  }

  it("reads an upload to its end before refusing it, so the browser gets the answer", async () => {
    const a = machine();
    const b = machine();
    await a.create();
    const exported = (await a.exported()).bytes;
    const filler = new Uint8Array(1024 * 1024).fill(9);
    const file = { name: `attachments/${sha256Of(filler)}.png`, bytes: filler };
    const mine = (await tablesOf(exported)).manifest.schema;
    const newer = await rewritten(
      exported,
      (tables) => {
        tables.manifest.schema = mine + 1;
      },
      [file],
    );
    for (const [body, status] of [
      [newer, 409],
      [await rewritten(exported, () => {}, [{ ...file, name: "attachments/forged.png" }, file]), 400],
      [new Uint8Array([0x1f, 0x8b, ...new Uint8Array(1024 * 1024)]), 400],
    ] as const) {
      const upload = counted(body);
      const res = await b.app.request(
        new Request("http://localhost/api/bundle/merge", {
          method: "POST",
          headers: { ...LOCAL, "content-type": "application/octet-stream" },
          body: upload.stream,
          duplex: "half",
        } as RequestInit),
      );
      expect(res.status).toBe(status);
      expect(upload.read()).toBe(body.length);
    }
  });
});

describe("screenshots in the bundle", () => {
  it("carries the screenshots' files to the other machine", async () => {
    const a = machine();
    const b = machine();
    const id = await a.create();
    const { sha256 } = await a.attach(id, PNG);
    expect((await b.merge((await a.exported()).bytes)).body).toMatchObject({ added: 1, screenshotsAdded: 1 });
    expect(readdirSync(b.dir)).toEqual([`${sha256}.png`]);
    const served = await b.app.request(`/api/attachments/files/${sha256}.png`, { headers: LOCAL });
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
  });

  it("refuses a file that doesn't match its name, a forged name, or one too big to be a screenshot, leaving nothing behind", async () => {
    const a = machine();
    const b = machine();
    const { sha256 } = await a.attach(await a.create(), PNG);
    const exported = (await a.exported()).bytes;
    for (const files of [
      [{ name: `attachments/${sha256}.png`, bytes: new TextEncoder().encode("not the image") }],
      [{ name: "attachments/../journal.db", bytes: PNG }],
      [{ name: `attachments/${sha256}.gif`, bytes: PNG }],
      [{ name: `attachments/${"0".repeat(64)}.png`, bytes: new Uint8Array(20 * 1024 * 1024 + 1) }],
    ]) {
      // Good files first: a later bad one still leaves none of them in place.
      const good = (await entriesOf(exported)).filter((entry) => entry.name !== TABLES);
      const res = await b.merge(await rewritten(exported, () => {}, [...good, ...files]));
      expect(res).toMatchObject({ status: 400 });
    }
    expect(b.mergeBackup).not.toHaveBeenCalled();
    expect(readdirSync(b.dir)).toEqual([]);
  });

  it("reads a bundle of more than 100 MB as a stream, with no cap on the whole", {
    timeout: 30_000,
  }, async () => {
    const a = machine();
    const b = machine();
    const { sha256 } = await a.attach(await a.create(), PNG);
    const entries = await entriesOf((await a.exported()).bytes);
    // An entry from a later version, which this one reads past: the size without writing 100 MB of images.
    const later = { name: "later/padding.bin", bytes: new Uint8Array(101 * 1024 * 1024) };
    const body = Readable.toWeb(Readable.from(tarChunks([...entries, later], 0)));
    const res = await b.app.request(
      new Request("http://localhost/api/bundle/merge", {
        method: "POST",
        headers: { ...LOCAL, "content-type": "application/octet-stream" },
        body: body as ReadableStream<Uint8Array>,
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ added: 1, screenshotsAdded: 1 });
    expect(readdirSync(b.dir)).toEqual([`${sha256}.png`]);
  });

  it("merges a gzipped bundle from before screenshots", async () => {
    const a = machine();
    const b = machine();
    await a.create();
    const tables = await tablesOf((await a.exported()).bytes);
    delete tables.tables.attachments;
    expect(await b.merge(gzipJson(tables))).toMatchObject({ status: 200, body: { added: 1 } });
  });
});
