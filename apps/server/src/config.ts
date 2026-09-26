import { join, posix, win32 } from "node:path";

/** Data lives outside the repo so trading history can never be committed (spec §5). */
export function resolveDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  if (env.TJ_DATA_DIR) return env.TJ_DATA_DIR;
  // Join with the target platform's separator, not the host's, so the result is right for `platform`.
  if (platform === "win32") {
    return win32.join(env.APPDATA ?? win32.join(home, "AppData", "Roaming"), "trading-journal");
  }
  return posix.join(env.XDG_DATA_HOME ?? posix.join(home, ".local", "share"), "trading-journal");
}

export interface DataPaths {
  dataDir: string;
  dbFile: string;
  backupDir: string;
  attachmentsDir: string;
  secretsFile: string;
}

export function dataPaths(dataDir: string): DataPaths {
  return {
    dataDir,
    dbFile: join(dataDir, "journal.db"),
    backupDir: join(dataDir, "backups"),
    attachmentsDir: join(dataDir, "attachments"),
    secretsFile: join(dataDir, "secrets.json"),
  };
}
