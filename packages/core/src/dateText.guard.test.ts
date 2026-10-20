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
/** Any `.toLocaleString(` call, with its arguments: a number is told from a date by them. */
const LOCALE_STRING = /\.toLocaleString\(([^)]*)\)/g;
/** The options a number's formatting takes here; any other key, or a spread, may be a date's. */
const NUMBER_OPTIONS = new Set([
  "style",
  "currency",
  "currencyDisplay",
  "signDisplay",
  "useGrouping",
  "notation",
  "compactDisplay",
  "minimumIntegerDigits",
  "minimumFractionDigits",
  "maximumFractionDigits",
  "minimumSignificantDigits",
  "maximumSignificantDigits",
]);

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

/** Whether a `.toLocaleString(…)`'s arguments read as a number's: "en-US", alone or with number options only. */
function numberArguments(args: string): boolean {
  const match = /^"en-US"(?:\s*,\s*\{([^}]*)\})?$/.exec(args.trim());
  if (!match) return false;
  const options = match[1];
  if (options === undefined) return true;
  if (options.includes("...")) return false;
  const keys = [...options.matchAll(/(\w+)\s*:/g)].map(([, key]) => key ?? "");
  return keys.length > 0 && keys.every((key) => NUMBER_OPTIONS.has(key));
}

/**
 * Whether a source formats a date itself. A `.toLocaleString(` counts unless it reads as a number's: on a date it
 * would follow the browser's language, or the US order, whatever the variable is called. A bare "en-US" on a variable
 * can't be told from a number's without types; `new Date(…)`'s is caught.
 */
const formatsDates = (source: string) =>
  FORMATTER.test(source) ||
  [...source.matchAll(LOCALE_STRING)].some(([, args = ""]) => !numberArguments(args));

describe("the guard", () => {
  it.each([
    "new Date(t).toLocaleString()",
    "trade.openedAt.toLocaleString()",
    'when.toLocaleString("en-GB")',
    'at.toLocaleString("en-US", { month: "short", day: "numeric" })',
    'new Intl.DateTimeFormat("en-US")',
    "d.toLocaleDateString()",
    'new Date(t).toLocaleString("en-US")',
    'at.toLocaleString("en-US", { hour12: false })',
    'at.toLocaleString("en-US", { hourCycle: "h23" })',
    'at.toLocaleString("en-US", { timeZoneName: "short" })',
    'at.toLocaleString("en-US", { ...options })',
    'at.toLocaleString("en-US", {})',
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
