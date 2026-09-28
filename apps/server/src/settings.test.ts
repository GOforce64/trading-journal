import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AlpacaKeys, KeyCheck, QuoteSource } from "@tj/market-data";
import { describe, expect, it } from "vitest";
import type { createApp } from "./app.js";
import { readSecrets } from "./config.js";
import { createMarketData } from "./marketData.js";
import { fakeSources, LOCAL, testApp } from "./testing.js";

const KEYS = { keyId: "PKTESTKEY7QXA", secretKey: "test-secret-do-not-log" };
const M = { price: 22.68, at: 1_790_279_911_052 };
const JSON_HEADERS = { ...LOCAL, "content-type": "application/json" };

interface Setup {
  check?: KeyCheck;
  keys?: AlpacaKeys | null;
  /** What secrets.json holds before the test; omitted means no file. */
  contents?: string;
}

function setup({ check = "ok", keys = null, contents }: Setup = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tj-settings-"));
  const secretsFile = join(dir, "secrets.json");
  if (contents !== undefined) writeFileSync(secretsFile, contents);
  const checked: AlpacaKeys[] = [];
  // Knows a price for every symbol, so a working key is easy to see through /api/quotes.
  const quotes: QuoteSource = { latest: async (symbols) => new Map(symbols.map((symbol) => [symbol, M])) };
  const market = createMarketData(keys, { build: () => fakeSources({ quotes }), log: () => {} });
  const app = testApp({
    market,
    settings: {
      dataDir: dir,
      secretsFile,
      checkKeys: async (tried) => {
        checked.push(tried);
        return check;
      },
    },
  });
  return { app, market, dir, secretsFile, checked };
}

const put = (
  app: ReturnType<typeof createApp>,
  body: string,
  headers: Record<string, string> = JSON_HEADERS,
) => app.request("/api/settings/market-data", { method: "PUT", headers, body });

describe("GET /api/settings", () => {
  it("shows the data directory and that market data is off", async () => {
    const { app, dir } = setup();
    const res = await app.request("/api/settings", { headers: LOCAL });
    expect(await res.json()).toEqual({
      dataDir: dir,
      marketData: { state: "off", message: null, keyIdHint: null },
    });
  });

  it("shows a hint of the saved key ID and never the secret", async () => {
    const { app } = setup({ keys: KEYS });
    const text = await (await app.request("/api/settings", { headers: LOCAL })).text();
    expect(JSON.parse(text).marketData).toEqual({ state: "on", message: null, keyIdHint: "PK…7QXA" });
    expect(text).not.toContain(KEYS.secretKey);
  });
});

describe("PUT /api/settings/market-data", () => {
  it("tests the key, saves it, and uses it from the next request on", async () => {
    const { app, secretsFile, checked } = setup();
    const res = await put(app, JSON.stringify(KEYS));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ marketData: { state: "on", keyIdHint: "PK…7QXA" } });
    expect(checked).toEqual([KEYS]);
    expect(readSecrets(secretsFile)).toEqual({ alpaca: KEYS });
    const quotes = await app.request("/api/quotes?symbols=M", { headers: LOCAL });
    expect(await quotes.json()).toEqual({ quotes: { M } });
  });

  it("keeps the other entries in the file", async () => {
    const { app, secretsFile } = setup({ contents: JSON.stringify({ ibkr: { flexToken: "keep-me" } }) });
    await put(app, JSON.stringify(KEYS));
    expect(JSON.parse(readFileSync(secretsFile, "utf8"))).toEqual({
      ibkr: { flexToken: "keep-me" },
      alpaca: KEYS,
    });
  });

  it.each([
    ["rejected", "Alpaca rejected this key"],
    ["not_paper", "use your Paper account's key"],
    ["unreachable", "Couldn't reach Alpaca"],
  ] as const)("refuses a key that fails the check (%s) and changes nothing", async (check, message) => {
    const { app, market, secretsFile } = setup({ check });
    const res = await put(app, JSON.stringify(KEYS));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe(check);
    expect(body.message).toContain(message);
    expect(existsSync(secretsFile)).toBe(false);
    expect(market.status().state).toBe("off");
  });

  it("refuses to overwrite a broken file, and leaves the running key alone", async () => {
    const broken = '{"ibkr": {"flexToken": ';
    const { app, market, secretsFile } = setup({ contents: broken });
    const res = await put(app, JSON.stringify(KEYS));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toContain("not valid JSON");
    expect(readFileSync(secretsFile, "utf8")).toBe(broken);
    expect(market.status().state).toBe("off");
  });

  it.each([
    ["text/plain", JSON.stringify(KEYS)],
    ["application/x-www-form-urlencoded", `keyId=${KEYS.keyId}&secretKey=${KEYS.secretKey}`],
  ])(
    "refuses a %s body, the kind another site could send, without testing or saving anything",
    async (type, body) => {
      const { app, secretsFile, checked } = setup();
      const res = await put(app, body, { ...LOCAL, "content-type": type });
      expect(res.status).toBe(400);
      expect(checked).toEqual([]);
      expect(existsSync(secretsFile)).toBe(false);
    },
  );

  it("never repeats the secret in an answer", async () => {
    const incomplete = await put(setup().app, JSON.stringify({ secretKey: KEYS.secretKey }));
    expect(incomplete.status).toBe(400);
    expect(await incomplete.text()).not.toContain(KEYS.secretKey);
    const refused = await put(setup({ check: "rejected" }).app, JSON.stringify(KEYS));
    expect(await refused.text()).not.toContain(KEYS.secretKey);
  });
});

describe("DELETE /api/settings/market-data", () => {
  it("removes the key, keeps the rest of the file, and turns market data off", async () => {
    const { app, market, secretsFile } = setup({
      keys: KEYS,
      contents: JSON.stringify({ ibkr: { flexToken: "keep-me" }, alpaca: KEYS }),
    });
    const res = await app.request("/api/settings/market-data", { method: "DELETE", headers: LOCAL });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ marketData: { state: "off", keyIdHint: null } });
    expect(JSON.parse(readFileSync(secretsFile, "utf8"))).toEqual({ ibkr: { flexToken: "keep-me" } });
    expect(market.sources()).toBeNull();
  });
});
