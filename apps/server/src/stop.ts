import type { Server } from "node:http";

/**
 * Stops taking connections and calls `done` once the requests in flight have ended (launcher spec §3.3), so a sync
 * or a merge is never cut off. The open page's keep-alive connections would hold `close()` open, so idle ones are
 * closed now and again until it ends.
 */
export function stopWhenIdle(server: Server, done: () => void, everyMs = 250): void {
  const timer = setInterval(() => server.closeIdleConnections(), everyMs);
  server.close(() => {
    clearInterval(timer);
    done();
  });
  server.closeIdleConnections();
}
