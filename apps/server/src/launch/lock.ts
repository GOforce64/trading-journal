import { linkSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";

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

/** The lock's text, or null once it's gone. */
const read = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/** Whether the lock file was last written a minute or more before `now`. */
const writtenLongAgo = (file: string, now: number) => {
  try {
    return now - statSync(file).mtimeMs >= STALE_MS;
  } catch {
    return true;
  }
};

/**
 * Takes the click's lock (launcher spec §3.2): created exclusively, so a second click while the first starts the
 * journal gets false. A lock older than a minute, or whose process is gone, is stale and taken over; one that can't be
 * read yet may be another click's still being written, so it's stale only once its file is a minute old.
 */
export function takeLock(file: string, now: number, alive = isAlive, pid = process.pid): boolean {
  const body = JSON.stringify({ pid, at: now });
  if (create(file, body)) return true;
  const seen = read(file);
  if (seen === null) return create(file, body);
  let held: { pid?: unknown; at?: unknown } = {};
  try {
    held = JSON.parse(seen) as typeof held;
  } catch {
    if (!writtenLongAgo(file, now)) return false;
  }
  const fresh =
    typeof held.at === "number" &&
    now - held.at < STALE_MS &&
    typeof held.pid === "number" &&
    alive(held.pid);
  if (fresh) return false;
  // Taken over only if it still holds what was judged stale: moved aside under a name of this click's own, it's put
  // back if another click took it over in the meantime.
  const aside = `${file}.${pid}.stale`;
  try {
    renameSync(file, aside);
  } catch {
    return false;
  }
  if (read(aside) !== seen) {
    try {
      linkSync(aside, file);
    } catch {
      // A third click holds the place now.
    }
    releaseLock(aside);
    return false;
  }
  releaseLock(aside);
  return create(file, body);
}

/** Keeps this click's lock fresh while a long install or build runs (launcher spec §3.2); another's is left alone. */
export function refreshLock(file: string, now: number, pid = process.pid): void {
  let held: { pid?: unknown } = {};
  try {
    held = JSON.parse(read(file) ?? "") as typeof held;
  } catch {
    return;
  }
  if (held.pid === pid) writeFileSync(file, JSON.stringify({ pid, at: now }));
}

export function releaseLock(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // Already gone.
  }
}
