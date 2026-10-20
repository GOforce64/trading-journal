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
const FORMATTER = /DateTimeFormat\(|toLocaleDateString|toLocaleTimeString/;
/** Any `.toLocaleString(` call, with what follows it: a number is told from a date by its arguments. */
const LOCALE_STRING = /\.toLocaleString\(([^)]*)\)/g;
/** How numbers are written here: "en-US", alone or with number options only. */
const NUMBER_FORMAT = /^"en-US"(\s*,\s*\{[^}]*\})?$/;
const DATE_OPTION = /\b(year|month|day|weekday|hour|minute|second|timeZone|dateStyle|timeStyle|era)\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "dist" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The browser's own date fields take their order from its language; only these two wrap one, for its picker. */
const DATE_FIELDS = new Set([
  "apps/web/src/components/DateField.tsx",
  "apps/web/src/components/DateTimeField.tsx",
]);
const DATE_INPUT = /type="(date|datetime-local)"|, "(date|datetime-local)"\)/;

const allSources = () =>
  ["apps", "packages"]
    .flatMap((top) => readdirSync(join(ROOT, top)).map((pkg) => join(ROOT, top, pkg, "src")))
    .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    .flatMap(sources)
    .map((file) => relative(ROOT, file).split(sep).join("/"));

/**
 * Whether a source formats a date itself. Any `.toLocaleString(` counts unless it reads as a number's: on a date it
 * would follow the browser's language, whatever the variable is called.
 */
const formatsDates = (source: string) =>
  FORMATTER.test(source) ||
  [...source.matchAll(LOCALE_STRING)].some(([, args = ""]) => {
    const trimmed = args.trim();
    return !NUMBER_FORMAT.test(trimmed) || DATE_OPTION.test(trimmed);
  });

describe("the guard", () => {
  it.each([
    "new Date(t).toLocaleString()",
    "trade.openedAt.toLocaleString()",
    'when.toLocaleString("en-GB")',
    'at.toLocaleString("en-US", { month: "short", day: "numeric" })',
    'new Intl.DateTimeFormat("en-US")',
    "d.toLocaleDateString()",
  ])("catches %s", (source) => {
    expect(formatsDates(source)).toBe(true);
  });

  it.each([
    'count.toLocaleString("en-US")',
    'value.toLocaleString("en-US", { maximumFractionDigits: 2 })',
    'pnl.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })',
  ])("lets numbers through: %s", (source) => {
    expect(formatsDates(source)).toBe(false);
  });
});

describe("dates", () => {
  it("are formatted only in dateText.ts", () => {
    const offenders = allSources()
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => formatsDates(readFileSync(join(ROOT, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("are typed only in DateField and DateTimeField, never in a browser date input", () => {
    const offenders = allSources()
      .filter((file) => !DATE_FIELDS.has(file))
      .filter((file) => DATE_INPUT.test(readFileSync(join(ROOT, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
