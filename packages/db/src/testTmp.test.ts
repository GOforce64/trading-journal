import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/** The root config's global setup, outside this package. */
const SETUP = join(dirname(fileURLToPath(import.meta.url)), "../../../scripts/vitest-tmp.ts");
const NAMES = ["TMPDIR", "TEMP", "TMP"] as const;
const env = () => Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

describe("the test run's temp folder", () => {
  it("is the run's own, which the run removes, so temp journals don't pile up", () => {
    expect(basename(tmpdir())).toMatch(/^tj-test-run-/);
  });

  it("puts the temp variables back when the run ends, so a watch restart can set up again", async () => {
    const { default: setup } = (await import(pathToFileURL(SETUP).href)) as { default: () => () => void };
    const before = env();
    try {
      const teardown = setup();
      expect(process.env.TMPDIR).not.toBe(before.TMPDIR);
      teardown();
      expect(env()).toEqual(before);
    } finally {
      for (const name of NAMES) {
        if (before[name] === undefined) delete process.env[name];
        else process.env[name] = before[name];
      }
    }
  });
});
