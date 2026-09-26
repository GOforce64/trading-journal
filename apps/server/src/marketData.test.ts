import { AlpacaError, type AlpacaKeys } from "@tj/market-data";
import { describe, expect, it } from "vitest";
import { createMarketData } from "./marketData.js";
import { fakeSources } from "./testing.js";

const KEYS = { keyId: "PKTESTKEY7QXA", secretKey: "test-secret-do-not-log" };

/** Builds fake sources and records which key each build was for. */
function recordingBuild() {
  const built: string[] = [];
  const build = (keys: AlpacaKeys) => {
    built.push(keys.keyId);
    return fakeSources();
  };
  return { built, build };
}

describe("createMarketData", () => {
  it("has no sources and is off without a key", () => {
    const market = createMarketData(null, { build: recordingBuild().build });
    expect(market.sources()).toBeNull();
    expect(market.status()).toEqual({ state: "off", message: null });
    expect(market.keyIdHint()).toBeNull();
  });

  it("builds the sources for the key it starts with, and shows only a hint of the key ID", () => {
    const { built, build } = recordingBuild();
    const market = createMarketData(KEYS, { build });
    expect(market.sources()).not.toBeNull();
    expect(built).toEqual(["PKTESTKEY7QXA"]);
    expect(market.status()).toEqual({ state: "on", message: null });
    expect(market.keyIdHint()).toBe("PK…7QXA");
  });

  it("rebuilds the sources for a new key, and drops them when the key is removed", () => {
    const { built, build } = recordingBuild();
    const market = createMarketData(KEYS, { build });
    const first = market.sources();
    market.configure({ keyId: "PKNEWKEYABCD", secretKey: "another-secret" });
    expect(built).toEqual(["PKTESTKEY7QXA", "PKNEWKEYABCD"]);
    expect(market.sources()).not.toBe(first);
    market.configure(null);
    expect(market.sources()).toBeNull();
    expect(market.status().state).toBe("off");
  });

  it("turns to error when Alpaca refuses the key, until a key is saved again", () => {
    const logs: string[] = [];
    const market = createMarketData(KEYS, { build: recordingBuild().build, log: (line) => logs.push(line) });
    market.report(new AlpacaError(401, "request is not authorized"));
    expect(market.status()).toEqual({
      state: "error",
      message: "Alpaca rejected the saved key. Save a new one below.",
    });
    expect(logs).toEqual(["Market data unavailable: Alpaca answered 401: request is not authorized"]);
    market.configure(KEYS);
    expect(market.status().state).toBe("on");
  });

  it("logs other failures and stays on", () => {
    const logs: string[] = [];
    const market = createMarketData(KEYS, { build: recordingBuild().build, log: (line) => logs.push(line) });
    market.report(new AlpacaError(500, "internal error"));
    market.report(new Error("The operation was aborted due to timeout"));
    expect(market.status().state).toBe("on");
    expect(logs).toHaveLength(2);
  });

  it("hands its sources a way to report failures", () => {
    let fromSource: ((error: unknown) => void) | undefined;
    const market = createMarketData(KEYS, {
      build: (_keys, report) => {
        fromSource = report;
        return fakeSources();
      },
      log: () => {},
    });
    fromSource?.(new AlpacaError(403, "forbidden"));
    expect(market.status().state).toBe("error");
  });
});
