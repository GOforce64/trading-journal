import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

const STALE_MS = 60_000;

/** Whether a process is still running: signal 0 checks without sending anything. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const create = (file: string, body: string) => {
  try {
    writeFileSync(file, body, { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
};

/**
 * Takes the click's lock (launcher spec §3.2): created exclusively, so a second click while the first starts the
 * journal gets false. A lock older than a minute, unreadable, or whose process is gone is stale and taken over.
 */
export function takeLock(file: string, now: number, alive = isAlive, pid = process.pid): boolean {
  const body = JSON.stringify({ pid, at: now });
  if (create(file, body)) return true;
  let held: { pid?: unknown; at?: unknown } = {};
  try {
    held = JSON.parse(readFileSync(file, "utf8")) as typeof held;
  } catch {
    // Unreadable: stale.
  }
  const fresh =
    typeof held.at === "number" &&
    now - held.at < STALE_MS &&
    typeof held.pid === "number" &&
    alive(held.pid);
  if (fresh) return false;
  releaseLock(file);
  return create(file, body);
}

export function releaseLock(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // Already gone.
  }
}
