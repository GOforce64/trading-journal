import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, runMigrations } from "@tj/db";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));

/** Sample broken-wing fly: short 50 straddle, wings 45 / 58, 4 lots, $8 fees, +$512. */
const sampleFly = {
  strategy: "iron_fly",
  book: "live",
  underlying: "xyz",
  openedAt: 1788_000_000_000,
  closedAt: 1788_086_400_000,
  netPnl: 512,
  fees: 8,
  legs: [],
  ironFly: {
    bodyPutStrike: 50,
    bodyCallStrike: 50,
    putWingStrike: 45,
    callWingStrike: 58,
    contracts: 4,
    creditPerShare: 3,
  },
};

const LOCAL = { host: "localhost" };
const JSON_HEADERS = { "content-type": "application/json", host: "localhost" };

interface TradeBody {
  id: string;
  underlying: string;
  grade: string | null;
  excluded: boolean;
  metrics: {
    maxLoss: number;
    riskySide: string;
    returnOnRisk: number | null;
    pctOfMaxProfit: number | null;
    pnlPctOfCost: number | null;
  } | null;
}

/** Response.json() is typed as unknown, so tests state the shape they expect. */
const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

describe("createApp", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-app-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    app = createApp({ db: openDatabase(file) });
  });

  const post = (body: unknown) =>
    app.request("/api/trades", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });

  it("answers health checks", async () => {
    const res = await app.request("/api/health", { headers: LOCAL });
    expect(res.status).toBe(200);
  });

  it("creates a trade and returns it with computed metrics", async () => {
    const res = await post(sampleFly);
    expect(res.status).toBe(201);
    const body = await readJson<TradeBody>(res);
    expect(body.underlying).toBe("XYZ");
    expect(body.metrics?.maxLoss).toBe(2008);
    expect(body.metrics?.riskySide).toBe("call");
    expect(body.metrics?.returnOnRisk).toBeCloseTo(0.255, 4);
  });

  it("gives an open trade its risk but no return, since it has no P&L yet", async () => {
    const body = await readJson<TradeBody>(await post({ ...sampleFly, closedAt: null, netPnl: null }));
    expect(body.metrics?.maxLoss).toBe(2008);
    expect(body.metrics?.returnOnRisk).toBeNull();
    expect(body.metrics?.pctOfMaxProfit).toBeNull();
    expect(body.metrics?.pnlPctOfCost).toBeNull();
  });

  it("rejects an invalid trade with 400 and a field path", async () => {
    const res = await post({ ...sampleFly, openedAt: -5 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await readJson<unknown>(res))).toContain("openedAt");
  });

  it("lists trades and honours the book filter", async () => {
    await post(sampleFly);
    await post({ ...sampleFly, book: "paper" });
    const res = await app.request("/api/trades?book=live", { headers: LOCAL });
    expect((await readJson<TradeBody[]>(res)).length).toBe(1);
  });

  it("patches a trade without disturbing its details", async () => {
    const created = await readJson<TradeBody>(await post(sampleFly));
    const res = await app.request(`/api/trades/${created.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ grade: "B", excluded: true, excludeReason: "test" }),
    });
    const body = await readJson<TradeBody>(res);
    expect(body.grade).toBe("B");
    expect(body.excluded).toBe(true);
    expect(body.metrics?.maxLoss).toBe(2008);
  });

  it("soft deletes a trade", async () => {
    const created = await readJson<TradeBody>(await post(sampleFly));
    const deleted = await app.request(`/api/trades/${created.id}`, { method: "DELETE", headers: LOCAL });
    expect(deleted.status).toBe(200);
    const after = await app.request(`/api/trades/${created.id}`, { headers: LOCAL });
    expect(after.status).toBe(404);
  });

  it("returns 404 for an unknown trade", async () => {
    const res = await app.request(`/api/trades/${crypto.randomUUID()}`, { headers: LOCAL });
    expect(res.status).toBe(404);
  });

  it("refuses requests with a foreign Host header", async () => {
    const res = await app.request("/api/health", { headers: { host: "evil.example.com" } });
    expect(res.status).toBe(403);
  });

  it("serves seeded setups and tags", async () => {
    const setups = await readJson<{ name: string }[]>(await app.request("/api/setups", { headers: LOCAL }));
    const tags = await readJson<{ kind: string }[]>(await app.request("/api/tags", { headers: LOCAL }));
    expect(setups.length).toBeGreaterThan(0);
    expect(tags.some((tag) => tag.kind === "mistake")).toBe(true);
  });

  it("creates a setup", async () => {
    const res = await app.request("/api/setups", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Gap fade", strategy: "scalp" }),
    });
    expect(res.status).toBe(201);
    expect((await readJson<{ name: string }>(res)).name).toBe("Gap fade");
  });
});
