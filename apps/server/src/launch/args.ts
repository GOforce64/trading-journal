/** What a click needs that the app menu's environment doesn't give (launcher spec §3.1). */
export interface LaunchArgs {
  pnpm: string;
  dataDir: string | null;
  port: number | null;
}

/** The arguments after `node`: tsx, the entry point, and what setup recorded. Run from apps/server. */
export function launchArgs(args: LaunchArgs): string[] {
  return [
    "--import",
    "tsx",
    "src/launch/main.ts",
    "--pnpm",
    args.pnpm,
    ...(args.dataDir ? ["--data-dir", args.dataDir] : []),
    ...(args.port ? ["--port", String(args.port)] : []),
  ];
}

/** Reads `process.argv.slice(2)` back into what `launchArgs` wrote. */
export function parseLaunchArgs(argv: readonly string[]): LaunchArgs {
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? (argv[at + 1] ?? null) : null;
  };
  const port = value("--port");
  return { pnpm: value("--pnpm") ?? "pnpm", dataDir: value("--data-dir"), port: port ? Number(port) : null };
}
