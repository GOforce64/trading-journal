import type { Server } from "node:http";

/** Servers already draining: a second Stop waits with the first rather than cutting it short. */
const stopping = new WeakSet<Server>();

/**
 * Stops taking connections and calls `done` once the requests in flight have ended (launcher spec §3.3), so a sync
 * or a merge is never cut off. The open page's keep-alive connections would hold `close()` open, so idle ones are
 * closed now and again until it ends. A second call while it drains does nothing; after `limitMs` whatever still
 * hangs is cut, so a stuck request can't keep the journal from stopping.
 */
export function stopWhenIdle(server: Server, done: () => void, everyMs = 250, limitMs = 120_000): void {
  if (stopping.has(server)) return;
  stopping.add(server);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    clearTimeout(limit);
    done();
  };
  const timer = setInterval(() => server.closeIdleConnections(), everyMs);
  const limit = setTimeout(() => {
    server.closeAllConnections();
    finish();
  }, limitMs);
  server.close(finish);
  server.closeIdleConnections();
}
