import { expiryMoment } from "./calendar.js";
import type { OptionRight } from "./model.js";

/** The risk-free rate for every solve (spec §7.2). Phase 2 may make it a setting. */
export const RATE = 0.04;
const YEAR_MS = 365 * 86_400_000;
const LOW = 0.01;
const HIGH = 10;

/** The standard normal CDF: Abramowitz & Stegun 26.2.17, error under 7.5e-8. */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const density = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const tail =
    density *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - tail : tail;
}

/** What exercising right now is worth: never below zero. */
export const intrinsic = (right: OptionRight, S: number, K: number): number =>
  Math.max(0, right === "C" ? S - K : K - S);

/** European Black-Scholes with no dividends. With no time or no volatility left, it's intrinsic value. */
export function bsPrice(
  right: OptionRight,
  S: number,
  K: number,
  T: number,
  sigma: number,
  r = RATE,
): number {
  if (T <= 0 || sigma <= 0) return intrinsic(right, S, K);
  const rootT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * rootT);
  const d2 = d1 - sigma * rootT;
  const discounted = K * Math.exp(-r * T);
  return right === "C"
    ? S * normCdf(d1) - discounted * normCdf(d2)
    : discounted * normCdf(-d2) - S * normCdf(-d1);
}

export interface ImpliedVolInput {
  right: OptionRight;
  price: number;
  S: number;
  K: number;
  T: number;
  r?: number;
}

/**
 * The volatility that makes Black-Scholes match `price`, by bisection between 1% and 1000%.
 * Null when there's nothing to solve: no time left, a price within half a cent of intrinsic value,
 * or a solve that ends at either bound.
 */
export function impliedVol({ right, price, S, K, T, r = RATE }: ImpliedVolInput): number | null {
  if (!(T > 0) || !(S > 0) || !(K > 0)) return null;
  if (price <= intrinsic(right, S, K) + 0.005) return null;
  let low = LOW;
  let high = HIGH;
  for (let step = 0; step < 100; step++) {
    const mid = (low + high) / 2;
    if (bsPrice(right, S, K, T, mid, r) > price) high = mid;
    else low = mid;
  }
  const sigma = (low + high) / 2;
  return sigma >= HIGH - 0.01 || sigma <= LOW + 1e-6 ? null : sigma;
}

/** Time from `at` to 16:00 New York on the expiry date, in 365-day years. */
export const yearsToExpiry = (at: number, expiry: string): number => (expiryMoment(expiry) - at) / YEAR_MS;
