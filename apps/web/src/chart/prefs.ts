import { useState } from "react";

export const TIMEFRAMES = [1, 2, 3, 5, 10, 15, 30, 60] as const;
export const timeframeLabel = (minutes: number): string => (minutes === 60 ? "1h" : `${minutes}m`);
/** `day` is a missed trade's chart showing the day's other trades (missed-trades spec §6.4). */
export const TOGGLES = ["ema0", "ema1", "ema2", "ema3", "vwap", "pm", "pd", "volume", "day"] as const;
export type Toggle = (typeof TOGGLES)[number];

export interface ChartPrefs {
  minutes: number;
  show: Record<Toggle, boolean>;
  emaLengths: number[];
}

export const DEFAULT_PREFS: ChartPrefs = {
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
};

const KEY = "tj.chart";
const isLength = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 500;

/** This browser's chart choices (spec §8). Storage can be missing or refuse, so anything odd falls back to the defaults. */
export function loadPrefs(): ChartPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved: unknown = JSON.parse(raw);
    if (typeof saved !== "object" || saved === null) return DEFAULT_PREFS;
    const { minutes, show: savedShow, emaLengths } = saved as Record<string, unknown>;
    const show = { ...DEFAULT_PREFS.show };
    for (const toggle of TOGGLES) {
      const value =
        typeof savedShow === "object" && savedShow !== null
          ? (savedShow as Record<string, unknown>)[toggle]
          : undefined;
      if (typeof value === "boolean") show[toggle] = value;
    }
    return {
      minutes: (TIMEFRAMES as readonly unknown[]).includes(minutes) ? Number(minutes) : DEFAULT_PREFS.minutes,
      show,
      emaLengths:
        Array.isArray(emaLengths) && emaLengths.length === 4 && emaLengths.every(isLength)
          ? emaLengths
          : DEFAULT_PREFS.emaLengths,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: ChartPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // A private window: the choice lasts until the page closes.
  }
}

/** The prefs, and a setter that remembers them. */
export function useChartPrefs(): [ChartPrefs, (next: ChartPrefs) => void] {
  const [prefs, setPrefs] = useState(loadPrefs);
  return [
    prefs,
    (next) => {
      savePrefs(next);
      setPrefs(next);
    },
  ];
}
