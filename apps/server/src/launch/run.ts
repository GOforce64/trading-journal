import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveDataDir } from "../config.js";
import { parseLaunchArgs } from "./args.js";
import { click } from "./click.js";
import { type LaunchPaths, logFile, openInBrowser, realEffects } from "./effects.js";
import { errorPage, type Failure, failureReason } from "./errorPage.js";
import { refreshLock, releaseLock, takeLock } from "./lock.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export interface RunDeps {
  click: typeof click;
  effects: (paths: LaunchPaths) => ReturnType<typeof realEffects>;
  open: (url: string) => void;
  exists: (path: string) => boolean;
  now: () => number;
  /** How often a click refreshes its lock while it works; 20 s unless a test says otherwise. */
  refreshEveryMs?: number;
}

/** One click on the icon, from its arguments to an exit code (launcher spec §3.2, §3.5). */
export async function runLaunch(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  overrides: Partial<RunDeps> = {},
): Promise<number> {
  const deps: RunDeps = {
    click,
    effects: realEffects,
    open: (url) => openInBrowser(url),
    exists: existsSync,
    now: Date.now,
    ...overrides,
  };
  const args = parseLaunchArgs(argv);
  const dataDir = args.dataDir ?? resolveDataDir(env, process.platform, homedir());
  const port = args.port ?? 4178;
  mkdirSync(join(dataDir, "logs"), { recursive: true });

  const fail = (failure: Failure) => {
    const page = join(dataDir, "launch-error.html");
    const log = existsSync(logFile(dataDir)) ? readFileSync(logFile(dataDir), "utf8") : "";
    writeFileSync(page, errorPage(failure, log));
    console.error(failureReason(failure));
    deps.open(pathToFileURL(page).href);
    return 1;
  };

  if (!deps.exists(args.pnpm)) return fail({ kind: "tool-missing", path: args.pnpm });
  const lock = join(dataDir, "launch.lock");
  // Another click is starting the journal, and opens the browser itself.
  if (!takeLock(lock, deps.now())) return 0;
  // A first install or build can outlast the lock's minute: kept fresh, it isn't taken over meanwhile.
  const keep = setInterval(() => refreshLock(lock, deps.now()), deps.refreshEveryMs ?? 20_000);
  try {
    const paths: LaunchPaths = { repo: REPO, dataDir, port, node: process.execPath, pnpm: args.pnpm };
    const outcome = await deps.click(deps.effects(paths), port);
    return outcome.kind === "failed" ? fail(outcome.failure) : 0;
  } catch (error) {
    // Still a page, so the icon never silently does nothing (spec §3.5).
    return fail({
      kind: "unexpected",
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  } finally {
    clearInterval(keep);
    releaseLock(lock);
  }
}
