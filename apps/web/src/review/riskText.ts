import type { Excursion, ScalpRisk } from "@tj/core";
import { rText } from "../analytics/format.js";
import { signedUsd } from "../components/Estimate.js";
import { usd } from "../components/ui.js";
import { heldText } from "../routes/ScalpTiles.js";

/** Up to 4 decimals, trailing zeros dropped: 1.06, 1.295. */
const premiumText = (value: number) => String(Number(value.toFixed(4)));
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A tile's value and its small print. */
export interface TileText {
  value: string;
  working: string;
}

export type RiskTileKey = "risk" | "r" | "rewardRisk" | "mae" | "mfe" | "model";

/** What the R row reads from the trade itself: its P&L, whether it's closed, and the stock's range. */
export interface RiskTileTrade {
  netPnl: number | null;
  closedAt: number | null;
  scalpPrices: { holdHigh: number | null; holdLow: number | null } | null;
}

/**
 * What each tile of the R row says (scalp-R spec §9.1). `rangeNote` says why a closed scalp's MAE and MFE wait for
 * the hold's range, such as Alpaca's 15-minute delay.
 */
export function riskTileText(
  risk: ScalpRisk,
  trade: RiskTileTrade,
  rangeNote = "needs the stock's range",
): Record<RiskTileKey, TileText> {
  const open = trade.closedAt == null;
  const planned = risk.plannedRisk;

  let riskWorking = "";
  if (risk.riskTyped) riskWorking = "typed";
  else if (planned != null && risk.optionAtStop != null && risk.entryPremium != null) {
    riskWorking = `option ${premiumText(risk.entryPremium)} → ${risk.optionAtStop.toFixed(2)} at the stop`;
    if (risk.estimated) riskWorking += " · estimated without IV";
  }

  let r: TileText = { value: open && planned != null ? "open" : "—", working: "" };
  if (risk.r != null && planned != null && trade.netPnl != null) {
    r = { value: rText(risk.r), working: `${signedUsd(trade.netPnl)} ÷ ${usd(planned)}` };
  }

  let reward = "";
  if (risk.plannedReward != null) {
    const priced = risk.targets.filter((target) => !target.wrongSide).length;
    reward = `reward ${usd(risk.plannedReward)} over ${count(priced, "target")}`;
    if (risk.runner) reward += ` · ${count(risk.runner.contracts, "runner")} at T${risk.runner.atTarget}`;
  }

  const low = `stock low ${trade.scalpPrices?.holdLow?.toFixed(2)}`;
  const high = `stock high ${trade.scalpPrices?.holdHigh?.toFixed(2)}`;
  const put = risk.right === "P";
  const excursion = (move: Excursion | null, sign: "−" | "+", where: string): TileText => {
    if (!move) return { value: "—", working: open ? "open" : rangeNote };
    const signed = (text: string) => (Number(text) === 0 ? text : `${sign}${text}`);
    const value = signed(move.move.toFixed(2));
    return { value, working: move.r == null ? where : `${signed(move.r.toFixed(2))}R · ${where}` };
  };

  let model: TileText = { value: "—", working: "" };
  if (risk.problem !== "not_single_long") {
    let value = "—";
    if (risk.iv != null) value = `IV ${(risk.iv * 100).toFixed(1)}%`;
    else if (risk.basis === "premium" || risk.estimated) value = "no IV";
    const stock = risk.stockAtEntry
      ? `stock ${risk.stockAtEntry.price.toFixed(2)}${risk.stockAtEntry.typed ? " typed" : ""}`
      : "no stock price";
    const left = risk.minutesToExpiry == null ? null : `${heldText(risk.minutesToExpiry * 60_000)} left`;
    model = { value, working: left ? `${stock} · ${left}` : stock };
  }

  return {
    risk: { value: planned == null ? "—" : usd(planned), working: riskWorking },
    r,
    rewardRisk: { value: risk.rewardRisk == null ? "—" : risk.rewardRisk.toFixed(1), working: reward },
    mae: excursion(risk.mae, "−", put ? high : low),
    mfe: excursion(risk.mfe, "+", put ? low : high),
    model,
  };
}

/** The line under the R row: how the stop was priced (spec §9.1). Nothing for a typed risk or on premium. */
export function modelNote(risk: ScalpRisk): string | null {
  if (risk.basis !== "stock" || risk.riskTyped || risk.plannedRisk == null) return null;
  return risk.estimated
    ? "Estimated without IV: the option at the stop is its intrinsic value there plus the time value paid at entry."
    : "Black-Scholes, the stock jumping straight to the stop. For 0DTE, time decay makes the real loss at the stop somewhat larger.";
}

/** Why a scalp has no planned risk, in the page's words (spec §9.1). `priceNote` explains a missing stock price. */
export function problemText(risk: ScalpRisk, priceNote: string): string {
  switch (risk.problem) {
    case "no_stop":
      return "Set a stop in the review strip to get R.";
    case "no_stock_price":
      return priceNote;
    case "wrong_side": {
      if (risk.basis === "premium") {
        return `The stop is at or above the entry premium (${premiumText(risk.entryPremium ?? 0)}), so it can't lose there.`;
      }
      const stock = risk.stockAtEntry?.price ?? 0;
      const put = risk.right === "P";
      // Compared at the cents the message shows, so a stop typed at 230.83 against 230.8279 reads "at".
      const cents = (price: number | null) => Math.round((price ?? 0) * 100);
      const where = cents(risk.stop) === cents(stock) ? "at" : put ? "below" : "above";
      return `The stop is ${where} the stock at entry (${stock.toFixed(2)}), so this ${put ? "put" : "call"} can't lose there.`;
    }
    case "cannot_price":
      return "The model can't price this option: type the planned risk.";
    case "not_single_long":
      return "R needs a single long option.";
    default:
      return "";
  }
}

/** The strip's live line (spec §9.2), e.g. "Risk $104.05 · R +0.43 · R:R 2.8". Null without a planned risk. */
export function liveLine(risk: ScalpRisk, open: boolean): string | null {
  if (risk.plannedRisk == null) return null;
  let r = "—";
  if (risk.r != null) r = rText(risk.r).slice(0, -1);
  else if (open) r = "open";
  const rewardRisk = risk.rewardRisk == null ? "—" : risk.rewardRisk.toFixed(1);
  return `Risk ${usd(risk.plannedRisk)} · R ${r} · R:R ${rewardRisk}`;
}
