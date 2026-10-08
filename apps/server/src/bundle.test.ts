import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
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

/** One machine's app, with a recorded merge backup. */
function machine() {
  const mergeBackup = vi.fn(() => "/backups/journal-merge-1.db");
  const app = testApp({ mergeBackup });
  return {
    app,
    mergeBackup,
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
  it("downloads the journal as a gzipped bundle named for this machine", async () => {
    const a = machine();
    const id = await a.create();
    const { res, bytes } = await a.exported();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/gzip");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="journal-[a-z0-9-]+-\d{4}-\d{2}-\d{2}-\d{4}\.tjbundle"$/,
    );
    const bundle = JSON.parse(gunzipSync(bytes).toString("utf8"));
    expect(bundle.manifest.format).toBe(1);
    expect(bundle.tables.trades.map((row: { id: string }) => row.id)).toEqual([id]);
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
    for (const body of [
      "not gzip",
      gzipJson("{"),
      gzipJson({}),
      gzipJson({ manifest: { format: 2 }, tables: {} }),
    ]) {
      expect(await b.merge(body)).toEqual({
        status: 400,
        body: { error: "invalid", message: "This isn't a journal bundle." },
      });
    }
    // Gzip of text that isn't JSON at all.
    expect((await b.merge(new Uint8Array(gzipSync("{")))).status).toBe(400);
    expect(b.mergeBackup).not.toHaveBeenCalled();
  });

  it("refuses a bundle from a newer version of the journal", async () => {
    const a = machine();
    const b = machine();
    await a.create();
    const bundle = JSON.parse(gunzipSync((await a.exported()).bytes).toString("utf8"));
    const mine = bundle.manifest.schema;
    bundle.manifest.schema = mine + 1;
    expect(await b.merge(gzipJson(bundle))).toEqual({
      status: 409,
      body: {
        error: "newer",
        message: `This bundle comes from a newer version of the journal (schema ${mine + 1}; this one is ${mine}). Update this machine first.`,
      },
    });
    expect(b.mergeBackup).not.toHaveBeenCalled();
  });
});
