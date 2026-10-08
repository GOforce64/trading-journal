/** A demo symbol: where its walk starts, how much it moves, how its options are priced and struck. */
export interface DemoSymbol {
  /** The price the daily walk starts from, about three and a half years before the demo ends. */
  start: number;
  /** Annual volatility of the stock. */
  vol: number;
  /** Its options' usual implied volatility. */
  iv: number;
  /** Shares a minute, on average. */
  volume: number;
  kind: "scalp" | "fly";
  /** The company, for the trade's name. */
  name: string;
}

/** The symbols the demo trades (demo spec §2): four to scalp, ten that report earnings for the flies. */
export const SYMBOLS: Record<string, DemoSymbol> = {
  SPY: {
    start: 420,
    vol: 0.16,
    iv: 0.15,
    volume: 120_000,
    kind: "scalp",
    name: "SPDR S&P 500 ETF",
  },
  QQQ: {
    start: 340,
    vol: 0.2,
    iv: 0.19,
    volume: 80_000,
    kind: "scalp",
    name: "Invesco QQQ Trust",
  },
  NVDA: { start: 60, vol: 0.45, iv: 0.5, volume: 300_000, kind: "scalp", name: "NVIDIA" },
  TSLA: { start: 220, vol: 0.55, iv: 0.6, volume: 150_000, kind: "scalp", name: "Tesla" },
  NFLX: { start: 600, vol: 0.35, iv: 0.35, volume: 8_000, kind: "fly", name: "Netflix" },
  ORCL: { start: 120, vol: 0.35, iv: 0.3, volume: 15_000, kind: "fly", name: "Oracle" },
  MU: {
    start: 90,
    vol: 0.45,
    iv: 0.45,
    volume: 20_000,
    kind: "fly",
    name: "Micron Technology",
  },
  NKE: { start: 100, vol: 0.3, iv: 0.3, volume: 15_000, kind: "fly", name: "Nike" },
  FDX: { start: 230, vol: 0.3, iv: 0.3, volume: 5_000, kind: "fly", name: "FedEx" },
  ADBE: { start: 450, vol: 0.3, iv: 0.3, volume: 6_000, kind: "fly", name: "Adobe" },
  COST: {
    start: 600,
    vol: 0.2,
    iv: 0.2,
    volume: 4_000,
    kind: "fly",
    name: "Costco Wholesale",
  },
  AVGO: { start: 90, vol: 0.4, iv: 0.4, volume: 25_000, kind: "fly", name: "Broadcom" },
  CRM: { start: 200, vol: 0.3, iv: 0.3, volume: 10_000, kind: "fly", name: "Salesforce" },
  LULU: {
    start: 350,
    vol: 0.4,
    iv: 0.4,
    volume: 5_000,
    kind: "fly",
    name: "Lululemon Athletica",
  },
};

export const SCALP_SYMBOLS = Object.keys(SYMBOLS).filter((symbol) => SYMBOLS[symbol]?.kind === "scalp");
export const FLY_SYMBOLS = Object.keys(SYMBOLS).filter((symbol) => SYMBOLS[symbol]?.kind === "fly");

/** The listed strike spacing near the money for a stock at `price`: tighter for cheaper stocks, as listings go. */
export const strikeStep = (price: number): number =>
  price < 25 ? 0.5 : price < 200 ? 1 : price < 500 ? 2.5 : 5;

export function symbolInfo(symbol: string): DemoSymbol {
  const info = SYMBOLS[symbol];
  if (!info) throw new Error(`not a demo symbol: ${symbol}`);
  return info;
}
