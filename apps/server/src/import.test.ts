import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createIbkrRepo, type Db, openDatabase, runMigrations } from "@tj/db";
import { parseOquants } from "@tj/importers";
import { fixturePayload, fixtureTrade, OQUANTS_HEADERS } from "@tj/importers/testing";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createApp } from "./app.js";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));
const JSON_HEADERS = { "content-type": "application/json", host: "localhost" };

interface PreviewBody {
  warnings: string[];
  counts: { new: number; existing: number; skipped: number };
  rows: { status: string; ticker: string; reason: string | null; flags: string[] }[];
}

const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

describe("oQuants import", () => {
  let app: ReturnType<typeof createApp>;
  let db: Db;
  let backup: Mock<() => string>;

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-import-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    backup = vi.fn(() => "journal-backup.db");
    db = openDatabase(file);
    app = createApp({ db, backup });
  });

  const send = (step: "preview" | "commit", body: unknown) =>
    app.request(`/api/import/oquants/${step}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });

  const payload = fixturePayload([fixtureTrade(), fixtureTrade({ ticker: "SPY", strategy: "VRP" })]);

  it("previews new and skipped rows without writing", async () => {
    const res = await send("preview", payload);
    expect(res.status).toBe(200);
    const body = await readJson<PreviewBody>(res);
    expect(body.counts).toEqual({ new: 1, existing: 0, skipped: 1 });
    expect(body.rows.map((row) => [row.status, row.ticker, row.reason])).toEqual([
      ["new", "XYZ", null],
      ["skipped", "SPY", "strategy VRP"],
    ]);
    expect(backup).not.toHaveBeenCalled();
  });

  it("imports new trades into the paper book after a backup", async () => {
    const res = await send("commit", payload);
    const body = await readJson<{ imported: number; backupFile: string | null; importedIds: string[] }>(res);
    expect(body).toMatchObject({ imported: 1, backupFile: "journal-backup.db" });
    expect(backup).toHaveBeenCalledOnce();

    const list = await readJson<{ id: string; underlying: string; book: string; source: string }[]>(
      await app.request("/api/trades", { headers: { host: "localhost" } }),
    );
    expect(list).toMatchObject([{ underlying: "XYZ", book: "paper", source: "oquants_extract" }]);
    // The Import page fills exactly these trades' stock prices next.
    expect(body.importedIds).toEqual([list[0]?.id]);
  });

  it("imports nothing, and takes no backup, when everything is already in", async () => {
    await send("commit", payload);
    backup.mockClear();

    const preview = await readJson<PreviewBody>(await send("preview", payload));
    expect(preview.counts).toEqual({ new: 0, existing: 1, skipped: 1 });
    expect(preview.rows[0]).toMatchObject({ status: "existing", reason: "already imported" });

    expect(await readJson(await send("commit", payload))).toEqual({
      imported: 0,
      backupFile: null,
      importedIds: [],
    });
    expect(backup).not.toHaveBeenCalled();
  });

  it("rejects something that is not a snippet export", async () => {
    expect((await send("preview", { format: "nope" })).status).toBe(400);
  });

  it("explains when oQuants changed its table", async () => {
    const headers = OQUANTS_HEADERS.filter((header) => header !== "Cost");
    const res = await send("preview", fixturePayload([fixtureTrade()], { headers }));
    expect(res.status).toBe(422);
    expect((await readJson<{ error: string }>(res)).error).toContain('"Cost"');
  });

  it("counts a fly already synced from IBKR as in the journal, and never imports it twice", async () => {
    const row = parseOquants(payload).rows.find((each) => each.kind === "trade");
    if (row?.kind !== "trade") throw new Error("the fixture has no trade");
    const ibkr = createIbkrRepo(db);
    ibkr.ensureAccount({ id: "acct", externalId: "DU1234567", kind: "paper" });
    // The same fly, synced from IBKR first: apply() stores it as an IBKR trade under its own id.
    ibkr.apply(
      {
        id: "synced-xyz",
        trade: row.trade,
        legIds: row.trade.legs.map((_, index) => `synced-xyz-${index}`),
      },
      "acct",
    );

    const preview = await readJson<PreviewBody>(await send("preview", payload));
    expect(preview.counts).toEqual({ new: 0, existing: 1, skipped: 1 });
    expect(preview.rows[0]).toMatchObject({ status: "existing", reason: "already synced from IBKR" });
    expect(await readJson(await send("commit", payload))).toEqual({
      imported: 0,
      backupFile: null,
      importedIds: [],
    });
  });
});
