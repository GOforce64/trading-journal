import { readFileSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import { z } from "zod";

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

const secretsSchema = z.object({
  alpaca: z.object({ keyId: z.string().min(1), secretKey: z.string().min(1) }).optional(),
});

export type Secrets = z.infer<typeof secretsSchema>;

/**
 * Reads the hand-made secrets file (spec §5). No file means no keys. A broken file
 * throws, naming the problem without repeating anything the file holds.
 */
export function readSecrets(file: string): Secrets {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // The parser's own message quotes the text around the mistake, which may be a key.
    throw new Error(`${file} is not valid JSON`);
  }
  const parsed = secretsSchema.safeParse(data);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "the top level").join(", ");
    throw new Error(`${file}: check ${fields}; expected {"alpaca": {"keyId": "…", "secretKey": "…"}}`);
  }
  return parsed.data;
}
