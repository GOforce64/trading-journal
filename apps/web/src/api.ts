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
