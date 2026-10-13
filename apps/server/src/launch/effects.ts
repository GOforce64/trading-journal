import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, posix, win32 } from "node:path";
import type { ClickEffects, LaunchState, Probe, UpdateResult } from "./click.js";
import { isAlive } from "./lock.js";

export interface LaunchPaths {
  repo: string;
  dataDir: string;
  port: number;
  node: string;
  pnpm: string;
}

export const journalUrl = (port: number) => `http://127.0.0.1:${port}/`;
export const logFile = (dataDir: string) => join(dataDir, "logs", "server.log");
const stateFile = (dataDir: string) => join(dataDir, "launcher.json");

/**
 * What answers on the port (launcher spec §3.2). A journal from before this change answers a bare `{ ok: true }`;
 * a port that holds the connection without answering is another program.
 */
export async function probe(port: number, timeoutMs = 1000): Promise<Probe> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: unknown;
      app?: unknown;
      pid?: unknown;
    } | null;
    if (body?.app === "trading-journal" || (body?.ok === true && body.app === undefined)) {
      return { kind: "journal", pid: typeof body.pid === "number" ? body.pid : null };
    }
    return { kind: "other" };
  } catch (error) {
    return (error as Error).name === "TimeoutError" ? { kind: "other" } : { kind: "down" };
  }
}

export async function pollUntil(
  check: () => Promise<boolean>,
  timeoutMs: number,
  giveUp: () => boolean = () => false,
  everyMs = 200,
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    if (giveUp()) return false;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  return check();
}

/**
 * The environment with the recorded node's folder first on PATH. An app-menu click doesn't get the terminal's PATH,
 * so with nvm, fnm or volta, pnpm's scripts wouldn't find node otherwise.
 */
export function nodeOnPath(
  env: NodeJS.ProcessEnv,
  node: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const windows = platform === "win32";
  const key = (windows && Object.keys(env).find((name) => name.toUpperCase() === "PATH")) || "PATH";
  const dir = (windows ? win32 : posix).dirname(node);
  return { ...env, [key]: [dir, env[key]].filter(Boolean).join(windows ? ";" : ":") };
}

/** Runs a command, keeping its output for the error page. A Windows `.cmd` needs a shell. */
function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<UpdateResult> {
  return new Promise((resolve) => {
    const shell = /\.(cmd|bat)$/i.test(command);
    const child = spawn(shell ? `"${command}"` : command, args, { cwd, env, shell, windowsHide: true });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", (error) => resolve({ ok: false, output: `${output}${error.message}\n` }));
    child.on("close", (code) => resolve({ ok: code === 0, output }));
  });
}

/**
 * Starts the server in the background (launcher spec §3.2): one node process with tsx loaded, so its pid is the
 * server's own; no window; output to logs/server.log, the last run's kept as server.1.log.
 */
export function startServer(
  paths: Pick<LaunchPaths, "repo" | "dataDir" | "port" | "node">,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const log = logFile(paths.dataDir);
  mkdirSync(dirname(log), { recursive: true });
  if (existsSync(log)) renameSync(log, join(dirname(log), "server.1.log"));
  const fd = openSync(log, "a");
  const child = spawn(paths.node, ["--import", "tsx", "src/index.ts"], {
    cwd: join(paths.repo, "apps", "server"),
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    env: { ...env, TJ_DATA_DIR: paths.dataDir, TJ_PORT: String(paths.port) },
  });
  child.unref();
  closeSync(fd);
  if (child.pid == null) throw new Error("The server process didn't start");
  return child.pid;
}

export function browserCommand(url: string, platform: NodeJS.Platform) {
  if (platform === "win32") return { command: "cmd", args: ["/c", `start "" "${url}"`], verbatim: true };
  return { command: platform === "darwin" ? "open" : "xdg-open", args: [url], verbatim: false };
}

/** Opens a URL in the default browser, Firefox included. */
export function openInBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const { command, args, verbatim } = browserCommand(url, platform);
  spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
  }).unref();
}

export function realEffects(paths: LaunchPaths): ClickEffects {
  return {
    probe: () => probe(paths.port),
    head: () =>
      new Promise((resolve) =>
        execFile("git", ["rev-parse", "HEAD"], { cwd: paths.repo, windowsHide: true }, (error, out) =>
          resolve(error ? null : out.trim() || null),
        ),
      ),
    readState: () => {
      try {
        return JSON.parse(readFileSync(stateFile(paths.dataDir), "utf8")) as LaunchState;
      } catch {
        return null;
      }
    },
    writeState: (state) => writeFileSync(stateFile(paths.dataDir), JSON.stringify(state)),
    stop: async (pid) => {
      await fetch(`http://127.0.0.1:${paths.port}/api/shutdown`, {
        method: "POST",
        signal: AbortSignal.timeout(1000),
      }).catch(() => undefined);
      // The port frees at once, but the process lives on until its requests in flight (a sync) are done.
      return pollUntil(async () => !isAlive(pid) && (await probe(paths.port)).kind === "down", 10_000);
    },
    update: async () => {
      const env = nodeOnPath(process.env, paths.node);
      const install = await run(paths.pnpm, ["install", "--frozen-lockfile"], paths.repo, env);
      if (!install.ok) return install;
      const build = await run(paths.pnpm, ["build"], paths.repo, env);
      return { ok: build.ok, output: install.output + build.output };
    },
    start: () => startServer(paths),
    waitUp: (pid) =>
      pollUntil(
        async () => {
          const found = await probe(paths.port);
          return found.kind === "journal" && found.pid === pid;
        },
        30_000,
        () => !isAlive(pid),
      ),
    openBrowser: () => openInBrowser(journalUrl(paths.port)),
    now: () => Date.now(),
  };
}
