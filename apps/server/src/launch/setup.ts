import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findOnPath, installLauncher, removeLauncher, stableNode } from "./install.js";

/** `pnpm launcher:install` and `pnpm launcher:remove` (launcher spec §3.1). */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const command = process.argv[2];

try {
  if (command === "install") {
    const pnpm = findOnPath("pnpm", process.env, process.platform);
    if (!pnpm) throw new Error("pnpm isn't on your PATH. Install pnpm, then run this again.");
    const port = process.env.TJ_PORT ? Number(process.env.TJ_PORT) : null;
    const file = installLauncher(
      {
        node: stableNode(process.execPath, process.env, process.platform),
        pnpm,
        repo: REPO,
        dataDir: process.env.TJ_DATA_DIR ?? null,
        port,
      },
      process.platform,
      process.env,
      homedir(),
    );
    const where =
      process.platform === "win32"
        ? "the Start menu (pin it to the taskbar)"
        : "your apps (pin it to the dock)";
    console.log(`Added Trading Journal to ${where}: ${file}`);
  } else if (command === "remove") {
    const file = removeLauncher(process.platform, process.env, homedir());
    console.log(file ? `Removed ${file}` : "There was no Trading Journal icon to remove.");
  } else {
    throw new Error("Use `pnpm launcher:install` or `pnpm launcher:remove`.");
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
