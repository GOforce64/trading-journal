import type { AppType } from "@tj/server/app";
import { hc } from "hono/client";

/** Same origin in production; Vite proxies /api to the server in development. */
export const api = hc<AppType>("/");

type TradeListResponse = Awaited<ReturnType<Awaited<ReturnType<typeof api.api.trades.$get>>["json"]>>;
export type TradeView = TradeListResponse[number];
