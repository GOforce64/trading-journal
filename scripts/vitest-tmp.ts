import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Vitest's global setup: the whole run writes its temp journals under one folder of its own, removed when the run
 * ends, so the suites' mkdtemp calls don't pile up in the system's temp folder. The workers start after this, with
 * the folder in their environment (TMPDIR on Linux and macOS, TEMP and TMP on Windows).
 */
export default function setup(): () => void {
  const root = mkdtempSync(join(tmpdir(), "tj-test-run-"));
  const names = ["TMPDIR", "TEMP", "TMP"] as const;
  const before = names.map((name) => [name, process.env[name]] as const);
  for (const name of names) process.env[name] = root;
  return () => {
    // Put the variables back first: watch mode runs this setup again in the same process after a config change.
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Best effort: Windows may still hold a file open as the run ends.
    }
  };
}
