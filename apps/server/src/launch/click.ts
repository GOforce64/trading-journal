import type { Failure } from "./errorPage.js";

/** What answers on the journal's port. */
export type Probe = { kind: "journal"; pid: number | null } | { kind: "other" } | { kind: "down" };

/** What the launcher remembers about the server it started: `<data dir>/launcher.json`. */
export interface LaunchState {
  pid: number;
  head: string | null;
  port: number;
  startedAt: number;
}

export interface UpdateResult {
  ok: boolean;
  output: string;
}

/** Everything a click does to the world, so its decisions can be tested (launcher spec §3.2). */
export interface ClickEffects {
  probe(): Promise<Probe>;
  /** `git rev-parse HEAD`, or null without git. */
  head(): Promise<string | null>;
  readState(): LaunchState | null;
  writeState(state: LaunchState): void;
  /** Asks the server to stop and waits up to 10 s for the port to free; false if it's still busy. */
  stop(): Promise<boolean>;
  /** `pnpm install --frozen-lockfile`, then `pnpm build`. */
  update(): Promise<UpdateResult>;
  /** Starts the server in the background; its process id. */
  start(): number;
  /** Polls health for up to 30 s until that process answers; false if it exits or time runs out. */
  waitUp(pid: number): Promise<boolean>;
  openBrowser(): void;
  now(): number;
}

export type ClickOutcome =
  | { kind: "opened"; started: boolean; restarted: boolean }
  | { kind: "failed"; failure: Failure };

const failed = (failure: Failure): ClickOutcome => ({ kind: "failed", failure });

/**
 * One click on the icon (launcher spec §3.2): open a running journal, restart one the launcher started on an older
 * commit, or update, start and open one that's down.
 */
export async function click(fx: ClickEffects, port: number): Promise<ClickOutcome> {
  const found = await fx.probe();
  if (found.kind === "other") return failed({ kind: "port-taken", port });
  let restarted = false;
  if (found.kind === "journal") {
    const state = fx.readState();
    const head = await fx.head();
    const ours = state != null && found.pid != null && state.pid === found.pid;
    if (!ours || head == null || state.head === head) {
      fx.openBrowser();
      return { kind: "opened", started: false, restarted: false };
    }
    if (!(await fx.stop())) return failed({ kind: "still-busy" });
    restarted = true;
  }
  const update = await fx.update();
  if (!update.ok) return failed({ kind: "update-failed", output: update.output });
  const pid = fx.start();
  fx.writeState({ pid, head: await fx.head(), port, startedAt: fx.now() });
  if (!(await fx.waitUp(pid))) return failed({ kind: "not-started" });
  fx.openBrowser();
  return { kind: "opened", started: true, restarted };
}
