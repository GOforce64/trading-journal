import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, runMigrations } from "@tj/db";
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
  let backup: Mock<() => string>;

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-import-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    backup = vi.fn(() => "journal-backup.db");
    app = createApp({ db: openDatabase(file), backup });
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
    expect(await readJson(res)).toEqual({ imported: 1, backupFile: "journal-backup.db" });
    expect(backup).toHaveBeenCalledOnce();

    const list = await readJson<{ underlying: string; book: string; source: string }[]>(
      await app.request("/api/trades", { headers: { host: "localhost" } }),
    );
    expect(list).toMatchObject([{ underlying: "XYZ", book: "paper", source: "oquants_extract" }]);
  });

  it("imports nothing, and takes no backup, when everything is already in", async () => {
    await send("commit", payload);
    backup.mockClear();

    const preview = await readJson<PreviewBody>(await send("preview", payload));
    expect(preview.counts).toEqual({ new: 0, existing: 1, skipped: 1 });
    expect(preview.rows[0]).toMatchObject({ status: "existing", reason: "already imported" });

    expect(await readJson(await send("commit", payload))).toEqual({ imported: 0, backupFile: null });
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
});
