import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlexCheck } from "@tj/importers";
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
  ibkrCheck?: FlexCheck;
}

function setup({ check = "ok", keys = null, contents, ibkrCheck = "ok" }: Setup = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tj-settings-"));
  const secretsFile = join(dir, "secrets.json");
  if (contents !== undefined) writeFileSync(secretsFile, contents);
  const checked: AlpacaKeys[] = [];
  const ibkrChecked: [string, string][] = [];
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
      checkIbkr: async (token, queryId) => {
        ibkrChecked.push([token, queryId]);
        return ibkrCheck;
      },
    },
  });
  return { app, market, dir, secretsFile, checked, ibkrChecked };
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
      ibkr: {
        paper: { configured: false, tokenHint: null, activityQueryId: null, todayQueryId: null, since: null },
        live: { configured: false, tokenHint: null, activityQueryId: null, todayQueryId: null, since: null },
      },
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

describe("IBKR Flex settings", () => {
  const TOKEN = "1234567890123456789012";
  const body = (fields: Record<string, unknown>) =>
    JSON.stringify({ activityQueryId: "1653145", todayQueryId: "1653147", since: "2026-09-28", ...fields });
  const putIbkr = (app: ReturnType<typeof createApp>, json: string, book = "paper") =>
    app.request(`/api/settings/ibkr/${book}`, { method: "PUT", headers: JSON_HEADERS, body: json });
  const LIVE_TOKEN = "2234567890123456789012";
  const liveBody = (fields: Record<string, unknown>) =>
    JSON.stringify({ activityQueryId: "2653145", todayQueryId: "2653147", since: "2026-01-02", ...fields });

  it("tests both queries with the token, saves them, and shows only a hint of the token", async () => {
    const { app, secretsFile, ibkrChecked } = setup();
    const res = await putIbkr(app, body({ token: TOKEN }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text).ibkr.paper).toEqual({
      configured: true,
      tokenHint: "12…9012",
      activityQueryId: "1653145",
      todayQueryId: "1653147",
      since: "2026-09-28",
    });
    expect(ibkrChecked).toEqual([
      [TOKEN, "1653145"],
      [TOKEN, "1653147"],
    ]);
    expect(readSecrets(secretsFile).ibkr?.token).toBe(TOKEN);
  });

  it("keeps the saved token when a save leaves it out", async () => {
    const { app, secretsFile } = setup();
    await putIbkr(app, body({ token: TOKEN }));
    // Any past start date: one after today in New York is refused.
    expect((await putIbkr(app, body({ since: "2026-09-20" }))).status).toBe(200);
    expect(readSecrets(secretsFile).ibkr).toMatchObject({ token: TOKEN, since: "2026-09-20" });
  });

  it.each([
    [
      "token_rejected",
      400,
      "IBKR rejected the token. Check it was copied in full, or generate a new one in Client Portal.",
    ],
    [
      "query_not_found",
      400,
      "IBKR doesn't know the Activity query 1653145. Check its ID on the Flex Queries page.",
    ],
    ["unreachable", 503, "Couldn't reach IBKR to test the token. Try again in a moment."],
  ] as const)("refuses to save when IBKR says %s", async (check, status, message) => {
    const { app, secretsFile } = setup({ ibkrCheck: check });
    const res = await putIbkr(app, body({ token: TOKEN }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: check, message });
    expect(existsSync(secretsFile)).toBe(false);
  });

  it("refuses letters in a query id, a start date in the future, and no token at all, without echoing them", async () => {
    const { app } = setup();
    for (const json of [
      body({ token: TOKEN, activityQueryId: "abc" }),
      body({ token: TOKEN, since: "2099-01-01" }),
      body({}),
    ]) {
      const res = await putIbkr(app, json);
      expect(res.status).toBe(400);
      const answer = (await res.json()) as { message: string };
      expect(answer.message).not.toContain("abc");
    }
  });

  it("removes the IBKR block and keeps the Alpaca key", async () => {
    const { app, secretsFile } = setup();
    await put(app, JSON.stringify(KEYS));
    await putIbkr(app, body({ token: TOKEN }));
    const res = await app.request("/api/settings/ibkr/paper", { method: "DELETE", headers: LOCAL });
    expect(((await res.json()) as { ibkr: { paper: { configured: boolean } } }).ibkr.paper.configured).toBe(
      false,
    );
    expect(readSecrets(secretsFile)).toEqual({ alpaca: KEYS });
  });

  it("saves the live account's queries beside paper's, and removes them alone", async () => {
    const { app, secretsFile } = setup();
    await putIbkr(app, body({ token: TOKEN }));
    expect((await putIbkr(app, liveBody({ token: LIVE_TOKEN }), "live")).status).toBe(200);
    const view = (await (await app.request("/api/settings", { headers: LOCAL })).json()) as {
      ibkr: Record<string, { configured: boolean; tokenHint: string | null; activityQueryId: string | null }>;
    };
    expect(view.ibkr).toEqual({
      paper: expect.objectContaining({ configured: true, tokenHint: "12…9012", activityQueryId: "1653145" }),
      live: expect.objectContaining({ configured: true, tokenHint: "22…9012", activityQueryId: "2653145" }),
    });
    expect(readSecrets(secretsFile)).toMatchObject({
      ibkr: { token: TOKEN },
      ibkrLive: { token: LIVE_TOKEN, since: "2026-01-02" },
    });
    const res = await app.request("/api/settings/ibkr/live", { method: "DELETE", headers: LOCAL });
    const after = (await res.json()) as { ibkr: Record<string, { configured: boolean }> };
    expect([after.ibkr.paper?.configured, after.ibkr.live?.configured]).toEqual([true, false]);
    expect(readSecrets(secretsFile).ibkr?.token).toBe(TOKEN);
  });

  it("tests the live queries with the live token, keeping the saved one when left out", async () => {
    const { app, secretsFile, ibkrChecked } = setup();
    await putIbkr(app, body({ token: TOKEN }));
    await putIbkr(app, liveBody({ token: LIVE_TOKEN }), "live");
    ibkrChecked.length = 0;
    expect((await putIbkr(app, liveBody({ since: "2026-02-03" }), "live")).status).toBe(200);
    expect(ibkrChecked).toEqual([
      [LIVE_TOKEN, "2653145"],
      [LIVE_TOKEN, "2653147"],
    ]);
    expect(readSecrets(secretsFile).ibkrLive).toMatchObject({ token: LIVE_TOKEN, since: "2026-02-03" });
  });

  it("asks for a live token rather than borrowing paper's", async () => {
    const { app, secretsFile } = setup();
    await putIbkr(app, body({ token: TOKEN }));
    expect((await putIbkr(app, liveBody({}), "live")).status).toBe(400);
    expect(readSecrets(secretsFile).ibkrLive).toBeUndefined();
  });

  it("refuses an unknown book", async () => {
    const { app, secretsFile } = setup();
    // The book check's own refusal, not the router's 404 for a path it doesn't know.
    expect((await putIbkr(app, body({ token: TOKEN }), "demo")).status).toBe(400);
    expect((await app.request("/api/settings/ibkr/demo", { method: "DELETE", headers: LOCAL })).status).toBe(
      400,
    );
    expect(existsSync(secretsFile)).toBe(false);
  });
});
