import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@tj/db";
import { describe, expect, it } from "vitest";
import { renameRetrying } from "./routes/attachments.js";
import { LOCAL, testApp, testDb } from "./testing.js";

const JSON_HEADERS = { "content-type": "application/json", ...LOCAL };
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const HASH = createHash("sha256").update(PNG).digest("hex");
const SCALP = {
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  openedAt: Date.UTC(2026, 8, 28, 13, 31),
  closedAt: Date.UTC(2026, 8, 28, 13, 46),
  netPnl: 44.74,
  fees: 2.26,
  legs: [
    { right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2, openPrice: 1.06, closePrice: 1.295 },
  ],
};

function setup(withDir = true) {
  const dir = mkdtempSync(join(tmpdir(), "tj-shots-"));
  const db = testDb();
  const app = testApp(withDir ? { db, attachmentsDir: dir } : { db });
  const send = (method: string, path: string, body?: string | Uint8Array, type = "application/json") =>
    app.request(path, { method, headers: { ...LOCAL, "content-type": type }, body });
  return {
    dir,
    db,
    app,
    async trade() {
      const res = await app.request("/api/trades", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(SCALP),
      });
      return ((await res.json()) as { id: string }).id;
    },
    upload: (tradeId: string, body: string | Uint8Array, type = "image/png") =>
      send("POST", `/api/trades/${tradeId}/attachments`, body, type),
    send,
  };
}

describe("POST /api/trades/:id/attachments", () => {
  it("stores an image once, by its content, however often it's attached", async () => {
    const { dir, app, trade, upload } = setup();
    const id = await trade();
    const first = await upload(id, PNG);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      tradeId: id,
      sha256: HASH,
      ext: "png",
      mime: "image/png",
      bytes: PNG.length,
    });
    expect((await upload(id, PNG)).status).toBe(201);
    expect(readdirSync(dir)).toEqual([`${HASH}.png`]);
    expect(readFileSync(join(dir, `${HASH}.png`))).toEqual(Buffer.from(PNG));
    const view = (await (await app.request(`/api/trades/${id}`, { headers: LOCAL })).json()) as {
      attachments: unknown[];
    };
    expect(view.attachments).toHaveLength(2);
  });

  it("refuses other types, an empty image, an unknown trade, and works only with a data directory", async () => {
    const { db, trade, upload } = setup();
    const id = await trade();
    const refused = await upload(id, "hello", "text/plain");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ message: "Screenshots can be PNG, JPEG or WebP." });
    expect((await upload(id, new Uint8Array())).status).toBe(400);
    expect((await upload("nope", PNG)).status).toBe(404);
    expect(db.select().from(schema.attachments).all()).toEqual([]);
    const bare = setup(false);
    expect((await bare.upload(await bare.trade(), PNG)).status).toBe(503);
  });

  it("refuses an image over 20 MB", async () => {
    const { trade, upload } = setup();
    const res = await upload(await trade(), new Uint8Array(20 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ message: "That image is over 20 MB." });
  });
});

describe("the attachment files and rows", () => {
  it("serves a file by its name, cached for good, and nothing for a forged or unknown name", async () => {
    const { app, trade, upload } = setup();
    await upload(await trade(), PNG);
    const res = await app.request(`/api/attachments/files/${HASH}.png`, { headers: LOCAL });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    // A browser never takes the file for anything but the image its name says.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    for (const name of ["..%2Fjournal.db", `${"0".repeat(64)}.png`, `${HASH}.gif`]) {
      expect((await app.request(`/api/attachments/files/${name}`, { headers: LOCAL })).status).toBe(404);
    }
  });

  it("captions and removes a screenshot", async () => {
    const { trade, upload, send } = setup();
    const row = (await (await upload(await trade(), PNG)).json()) as { id: string };
    const captioned = await send(
      "PATCH",
      `/api/attachments/${row.id}`,
      JSON.stringify({ caption: " flush " }),
    );
    expect(await captioned.json()).toMatchObject({ caption: "flush" });
    expect((await send("DELETE", `/api/attachments/${row.id}`)).status).toBe(204);
    expect((await send("DELETE", `/api/attachments/${row.id}`)).status).toBe(404);
    expect((await send("PATCH", `/api/attachments/${row.id}`, JSON.stringify({ caption: "x" }))).status).toBe(
      404,
    );
  });
});

describe("renameRetrying (Windows: an antivirus scan holds a new file for a moment)", () => {
  const failing = (code: string, times: number) => {
    const calls: string[][] = [];
    const rename = (from: string, to: string) => {
      calls.push([from, to]);
      if (calls.length <= times) throw Object.assign(new Error(`${code}: rename`), { code });
    };
    return { calls, rename };
  };
  const waits: number[] = [];
  const pause = async (ms: number) => {
    waits.push(ms);
  };

  it("tries again after a short pause while the file is held, then moves it", async () => {
    waits.length = 0;
    const { calls, rename } = failing("EPERM", 2);
    await renameRetrying("a.tmp", "a.png", { rename, pause });
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual(["a.tmp", "a.png"]);
    expect(waits).toEqual([100, 200]);
    const busy = failing("EBUSY", 1);
    await renameRetrying("b.tmp", "b.png", { rename: busy.rename, pause });
    expect(busy.calls).toHaveLength(2);
  });

  it("gives up after five tries, and at once on any other error", async () => {
    const held = failing("EPERM", 99);
    await expect(renameRetrying("a.tmp", "a.png", { rename: held.rename, pause })).rejects.toThrow("EPERM");
    expect(held.calls).toHaveLength(5);
    const missing = failing("ENOENT", 99);
    await expect(renameRetrying("a.tmp", "a.png", { rename: missing.rename, pause })).rejects.toThrow(
      "ENOENT",
    );
    expect(missing.calls).toHaveLength(1);
  });
});
