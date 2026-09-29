import type { AppType } from "@tj/server/app";
import { hc } from "hono/client";

/** Same origin in production; Vite proxies /api to the server in development. */
export const api = hc<AppType>("/");

type TradeListResponse = Awaited<ReturnType<Awaited<ReturnType<typeof api.api.trades.$get>>["json"]>>;
export type TradeView = TradeListResponse[number];

type FillResponse = Awaited<ReturnType<typeof api.api.moves.fill.$post>>;
/** What one fill run did (spec §8.2). */
export type FillResult = Awaited<ReturnType<FillResponse["json"]>>;

/** The server explains a refusal in `message`; fall back to the status. */
export async function refusal(
  res: { status: number; json(): Promise<unknown> },
  action: string,
): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(body.message ?? `${action} failed: ${res.status}`);
}

/** One fill on the trade page's Fills panel (spec §9.5). */
export interface TradeFill {
  id: string;
  executedAt: number;
  quantity: number;
  price: number;
  commission: number;
  kind: string;
  canceled: boolean;
  openClose: string | null;
  right: string;
  strike: number;
  expiry: string;
}

/** A trade as its own page loads it: with its fills. */
export type TradeDetailView = TradeView & { fills: TradeFill[] };
