import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The file that marks a directory as a demo's, so the next `pnpm demo` may wipe it (demo spec §4). */
export const DEMO_MARKER = ".tj-demo";

/** Where `pnpm demo` keeps its journal: `TJ_DEMO_DIR`, or a directory in the system's temp directory. */
export const demoDir = (env: NodeJS.ProcessEnv, tmp: string): string =>
  env.TJ_DEMO_DIR ?? join(tmp, "trading-journal-demo");

/**
 * A fresh, marked demo directory. Never the real data directory, and never one holding files without the marker:
 * the demo only ever wipes what an earlier demo made.
 */
export function prepareDemoDir(dir: string, realDataDir: string): void {
  if (resolve(dir) === resolve(realDataDir)) {
    throw new Error(
      `${dir} is your journal's data directory: the demo never touches it. Set TJ_DEMO_DIR elsewhere.`,
    );
  }
  if (existsSync(dir) && readdirSync(dir).length > 0 && !existsSync(join(dir, DEMO_MARKER))) {
    throw new Error(
      `${dir} holds files that aren't a demo's, so it's left alone. Set TJ_DEMO_DIR elsewhere.`,
    );
  }
  // The marker goes last, so a wipe that fails partway leaves a directory the next run may still clear.
  mkdirSync(dir, { recursive: true });
  try {
    for (const entry of readdirSync(dir)) {
      if (entry !== DEMO_MARKER) rmSync(join(dir, entry), { recursive: true, force: true });
    }
  } catch (error) {
    throw new Error(
      `${dir} couldn't be cleared (${(error as Error).message}). If a demo is still running, stop it first.`,
    );
  }
  writeFileSync(join(dir, DEMO_MARKER), "A demo journal made by `pnpm demo`. The next run replaces it.\n");
}

/** `--seed N` and `--end YYYY-MM-DD`; the end must be a day before `today` (New York), whose bars are final. */
export function parseDemoArgs(argv: readonly string[], today: string): { seed: number; end: string | null } {
  let seed = 42;
  let end: string | null = null;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") continue;
    const value = argv[index + 1] ?? "";
    if (arg === "--seed") {
      if (!/^\d+$/.test(value)) throw new Error(`--seed takes a whole number, not "${value}".`);
      seed = Number(value);
      index++;
    } else if (arg === "--end") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new Error(`--end takes a date as YYYY-MM-DD, not "${value}".`);
      if (value >= today) throw new Error(`--end must be a day before today (${today} in New York).`);
      end = value;
      index++;
    } else {
      throw new Error(`${arg} isn't an option: use --seed N and --end YYYY-MM-DD.`);
    }
  }
  return { seed, end };
}
