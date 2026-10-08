import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "./prefs.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("chart preferences", () => {
  it("starts on 3m with every indicator on and EMAs 8, 20, 50 and 167", () => {
    expect(loadPrefs()).toEqual({
      minutes: 3,
      show: {
        ema0: true,
        ema1: true,
        ema2: true,
        ema3: true,
        vwap: true,
        pm: true,
        pd: true,
        volume: true,
        day: true,
      },
      emaLengths: [8, 20, 50, 167],
    });
  });

  it("shows the day's trades for choices saved before there was such a toggle", () => {
    localStorage.setItem(
      "tj.chart",
      JSON.stringify({
        minutes: 5,
        show: { ...DEFAULT_PREFS.show, vwap: false, day: undefined },
        emaLengths: [8, 20, 50, 167],
      }),
    );
    expect(loadPrefs().show).toMatchObject({ vwap: false, day: true });
  });

  it("remembers the last choices in this browser", () => {
    savePrefs({
      ...DEFAULT_PREFS,
      minutes: 5,
      show: { ...DEFAULT_PREFS.show, vwap: false },
      emaLengths: [9, 21, 50, 200],
    });
    expect(loadPrefs()).toMatchObject({
      minutes: 5,
      show: { vwap: false, pd: true },
      emaLengths: [9, 21, 50, 200],
    });
  });

  it("falls back to the defaults for anything it doesn't recognise", () => {
    localStorage.setItem("tj.chart", "{not json");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem("tj.chart", JSON.stringify({ minutes: 4, show: { vwap: false, bogus: false } }));
    expect(loadPrefs()).toMatchObject({ minutes: 3, show: { vwap: false } });
    expect(loadPrefs().show).not.toHaveProperty("bogus");
  });

  it("works when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(DEFAULT_PREFS)).not.toThrow();
  });
});
