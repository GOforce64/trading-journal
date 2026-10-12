import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Not `new URL(…, import.meta.url)`: under the web tests Vite rewrites that into an asset URL.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Files that read a clock to compute a date and never show one (launcher-keys-palette spec §8.1). */
const ALLOWED = new Set([
  "packages/core/src/calendar.ts",
  "packages/core/src/marks.ts",
  "packages/importers/src/oquants/time.ts",
  "packages/importers/src/oquants/payload.ts",
]);
const FORMATTER =
  /DateTimeFormat\(|toLocaleDateString|toLocaleTimeString|new Date\([^)]*\)\.toLocaleString\(/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "dist" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("dates", () => {
  it("are formatted only in dateText.ts", () => {
    const offenders = ["apps", "packages"]
      .flatMap((top) => readdirSync(join(ROOT, top)).map((pkg) => join(ROOT, top, pkg, "src")))
      .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
      .flatMap(sources)
      .map((file) => relative(ROOT, file).split(sep).join("/"))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => FORMATTER.test(readFileSync(join(ROOT, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
