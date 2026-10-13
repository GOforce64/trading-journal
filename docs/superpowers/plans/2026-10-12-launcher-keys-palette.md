# European Dates, Launcher, Keyboard Review and Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Every date reads the European way: "28 Sep 2026" shown, `9/12/26` typed as 9 December 2026.
- A **Trading Journal** icon starts the server in the background and opens the browser.
- A scalp review can be done from the keyboard: J/K, 1–5, Enter, S/M/E/N, P/T/X and ?.
- Ctrl+K finds pages, tabs and trades.

**Architecture:**
- **`packages/core/src/dateText.ts`:** every date shown or typed goes through it. It's built on `nyDate` and `nyMinuteOfDay`, with no `Intl`, so the browser's language can't change it. A guard test bans date formatters anywhere else.
- **`apps/server/src/launch/`:**
  - the click's decisions, as a pure function over injected effects;
  - the real effects (health probe, git, pnpm, spawn, browser);
  - the lock, the error page, and the icon setup.
- **The server:** gains `pid` in `/api/health` and a `POST /api/shutdown` that waits for the requests in flight.
- **`apps/web/src/keys/`:** one window key listener with a registry. Pages register keys, modals push a layer that blocks page keys, and the ? help reads the registry.
- **`apps/web/src/nav/`:** "the list you came from" travels in the history entry's state. `useTradeNav` turns it into next and previous, falling back to the review queue.
- **`apps/web/src/palette/`:** a pure query parser, plus a cmdk dialog over the cached trade list.

**Tech Stack:** TypeScript, React 19, TanStack Router and Query, Hono on Node 22, Vitest with jsdom, Biome, cmdk 1.1.1 (new).

**Spec:** [docs/superpowers/specs/2026-10-12-launcher-keyboard-palette-design.md](../specs/2026-10-12-launcher-keyboard-palette-design.md)

## Global Constraints

- **Dates shown:**
  - day first, short month name, 24-hour time: "28 Sep", "28 Sep 2026", "28 Sep 09:35", "28 Sep 09:35:12";
  - "Sep 2026" and "September 2026" for months;
  - contracts read "NVDA 232.5C 26 Sep";
  - **"Sep", never "Sept"**;
  - days are New York dates for instants, and a plain `YYYY-MM-DD` is shown as that date.
- **Dates typed:**
  - day/month/year with `/`, `.` or `-`. Two-digit years are 20YY. ISO `YYYY-MM-DD` is also accepted. `9/12/26` is 2026-12-09, and `9/28/2026` is not a date.
  - Date fields show `DD/MM/YYYY`.
- **No date formatter outside `dateText.ts`:** no `Intl.DateTimeFormat`, `toLocaleDateString`, `toLocaleTimeString`, or `toLocaleString` on a Date. The exceptions are `core/calendar.ts`, `core/marks.ts`, `importers/oquants/time.ts` and `importers/oquants/payload.ts`.
- **Ports:** the journal's default port is **4178**; `TJ_PORT` and `TJ_DATA_DIR` override it as now. The demo stays on 4179.
- **`GET /api/health`** answers `{ ok: true, app: "trading-journal", pid }`, where pid is a number or null.
- **Launcher numbers:**
  - the health probe times out after 1 s;
  - start polls every 200 ms for up to 30 s;
  - the old server gets up to 10 s to stop;
  - a lock goes stale after 60 s or when its process is gone;
  - logs are `<data dir>/logs/server.log`, with the previous run kept as `server.1.log`;
  - the error page shows the last 40 lines.
- **Copy, word for word:**
  - **The launcher's error page:**
    - "Port 4178 is used by another program. Close it, or set TJ_PORT and run `pnpm launcher:install` again." (the port number is the real one);
    - "Updating the journal failed";
    - "The journal didn't start";
    - "The journal is finishing a sync before it restarts with your update. Click the icon again in a minute.";
    - "Node (or pnpm) is no longer at <path>. Run `pnpm launcher:install` again."
  - **Stop:** the button "Stop the journal"; the stopped screen "The journal has stopped. Open it again from its icon, or run `pnpm start`."
  - **The date field:** "Not a date: day/month/year".
  - **Hints:** "Press ? for shortcuts"; the nav button "Search · Ctrl K".
  - **The palette:**
    - the footer "↑↓ move · Enter open · Esc close";
    - "+N more · keep typing to narrow";
    - "No trades match 'xyz'";
    - "Loading trades…";
    - "Couldn't load trades".
- **cmdk is pinned at exactly `1.1.1`.**
- **Tests stay light for Windows CI:**
  - close every database you open;
  - write no big files;
  - kill every process you spawn;
  - never use `pkill -f` (it matches your own shell); kill by PID from `lsof -ti:PORT -sTCP:LISTEN`.
- **Before each commit:** `pnpm format` (twice if Biome asks), then `pnpm lint`, `pnpm typecheck`, and the changed packages' tests. The full `pnpm test` runs before the PR.

## Review Focus

1. **A late-evening New York time** (23:30 ET, already the next day in Dublin and UTC) must show New York's date, not the browser's. *(Task 1: `dayText` at 2026-09-29 03:30 UTC → "28 Sep".)*
2. **Two clicks on the icon in quick succession** must not start two servers. A crash must not leave a lock that blocks every later click. *(Task 5: lock held, stale by age, stale by dead pid. Task 6: the lock is released when the click throws.)*
3. **Enter right after clicking grade B with the mouse** must not click B again and clear the grade. *(Task 9: the layer takes Enter on a pointer-focused button. Task 11: the trade page test clicks B, then presses Enter.)*
4. **A bad date typed in the + Missed trade popover, then Enter,** must not open a chart for the old date. *(Task 3: DateField in a form: bad date, Enter, no submit.)*
5. **Typing J or a digit into the notes, a chip's name field, or the palette's input** must type it, never jump trades or set a grade. *(Task 9: the layer ignores keys from fields. Task 13: typing "j" in the palette input doesn't navigate.)*

---

## Ledger and workflow

- **The ledger** is `.superpowers/sdd/launcher-keys-palette/progress.md` (git-ignored). One line per task: `DONE <sha>`, the test count from vitest's ` Tests ` line, and any ruling.
- **Running tools:**
  - tsx is `node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs`;
  - never `bash -c`;
  - one package's tests: `pnpm --filter @tj/<pkg> exec vitest run <files>`.
- **Web tests:**
  - stub `fetch` with `vi.stubGlobal` as `QueueBar.test.tsx` does, and `waitFor` before reading a query's data;
  - chart components are mocked with `apps/web/src/chart/testing.ts`;
  - New York's "today" lags the user's (UTC+1), so keep test dates in the past.
- **Commits** end with the `Co-Authored-By` line from the session's attribution reminder.

---

## Part A — European dates (spec §8)

### Task 1: core — `dateText.ts`

**Files:**
- Create: `packages/core/src/dateText.ts`, `packages/core/src/dateText.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./dateText.js";`)

**Interfaces (produces):**
```ts
/** An instant (epoch ms, read in New York) or a calendar date ("2026-09-28", shown as is). */
export type When = number | string;
export function dayText(when: When): string;                       // "28 Sep"
export function dayYearText(when: When): string;                   // "28 Sep 2026"
export function clockText(at: number, options?: { seconds?: boolean }): string;   // "09:35", "09:35:12"
export function dayTimeText(at: number, options?: { year?: boolean; seconds?: boolean }): string; // "28 Sep 09:35"
export function monthName(date: string): string;                   // "2026-09" or "2026-09-28" → "Sep"
export function monthText(month: string, options?: { long?: boolean }): string;  // "Sep 2026", "September 2026"
export function fieldDate(date: string): string;                   // "2026-12-09" → "09/12/2026"
export function parseDayMonthYear(text: string): string | null;    // "9/12/26" → "2026-12-09"
export function parseDayMonth(text: string, today: string): string | null; // "9/12", latest on or before today
```

- [ ] **Step 1: Write the tests** (`dateText.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import {
  clockText,
  dayText,
  dayTimeText,
  dayYearText,
  fieldDate,
  monthName,
  monthText,
  parseDayMonth,
  parseDayMonthYear,
} from "./dateText.js";

// 09:35:12 in New York on 28 Sep 2026 (EDT, UTC−4).
const MORNING = Date.UTC(2026, 8, 28, 13, 35, 12);

describe("dates shown", () => {
  it("writes the day first, in New York", () => {
    expect(dayText(MORNING)).toBe("28 Sep");
    expect(dayYearText(MORNING)).toBe("28 Sep 2026");
    // 23:30 in New York is already the 29th in Dublin and UTC.
    expect(dayText(Date.UTC(2026, 8, 29, 3, 30))).toBe("28 Sep");
    // Winter time (EST, UTC−5).
    expect(dayTimeText(Date.UTC(2026, 11, 9, 14, 30))).toBe("9 Dec 09:30");
  });

  it("shows a plain date as that date", () => {
    expect(dayText("2026-12-09")).toBe("9 Dec");
    expect(dayYearText("2026-01-01")).toBe("1 Jan 2026");
  });

  it("uses 24-hour times, with seconds when asked", () => {
    expect(clockText(MORNING)).toBe("09:35");
    expect(clockText(MORNING, { seconds: true })).toBe("09:35:12");
    expect(clockText(Date.UTC(2026, 8, 28, 21, 5))).toBe("17:05");
    expect(dayTimeText(MORNING)).toBe("28 Sep 09:35");
    expect(dayTimeText(MORNING, { year: true })).toBe("28 Sep 2026 09:35");
    expect(dayTimeText(MORNING, { seconds: true })).toBe("28 Sep 09:35:12");
  });

  it("names every month in three letters, never Sept", () => {
    const names = Array.from({ length: 12 }, (_, i) => monthName(`2026-${String(i + 1).padStart(2, "0")}`));
    expect(names).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
    expect(monthName("2026-09-28")).toBe("Sep");
  });

  it("writes months and field dates", () => {
    expect(monthText("2026-09")).toBe("Sep 2026");
    expect(monthText("2026-09", { long: true })).toBe("September 2026");
    expect(fieldDate("2026-12-09")).toBe("09/12/2026");
  });
});

describe("dates typed", () => {
  it.each([
    ["9/12/26", "2026-12-09"],
    ["09/12/2026", "2026-12-09"],
    ["9.12.26", "2026-12-09"],
    ["9-12-2026", "2026-12-09"],
    [" 9/12/2026 ", "2026-12-09"],
    ["2026-12-09", "2026-12-09"],
    ["29/2/2028", "2028-02-29"],
  ])("reads %s as %s", (text, date) => {
    expect(parseDayMonthYear(text)).toBe(date);
  });

  it.each(["31/02/2026", "9/28/2026", "29/2/2026", "9/12", "9/12/202", "2026-13-01", "", "abc"])(
    "refuses %s",
    (text) => {
      expect(parseDayMonthYear(text)).toBeNull();
    },
  );

  it("reads a day and month as the latest such date on or before today", () => {
    expect(parseDayMonth("9/12", "2026-10-12")).toBe("2025-12-09");
    expect(parseDayMonth("12/10", "2026-10-12")).toBe("2026-10-12");
    expect(parseDayMonth("13.10", "2026-10-12")).toBe("2025-10-13");
    expect(parseDayMonth("29/2", "2026-10-12")).toBe("2024-02-29");
    expect(parseDayMonth("9/28", "2026-10-12")).toBeNull();
    expect(parseDayMonth("9/12/26", "2026-10-12")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them; they fail:** `pnpm --filter @tj/core exec vitest run src/dateText.test.ts` (the module doesn't exist).
- [ ] **Step 3: Implement `dateText.ts`:**

```ts
import { nyMinuteOfDay } from "./calendar.js";
import { nyDate } from "./marks.js";

/**
 * Every date the app shows or reads, the European way (launcher-keys-palette spec §8): day first, the month as a
 * short name, 24-hour times; typed dates day/month/year. No Intl, so the browser's language can't change it.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** An instant (epoch ms, read in New York) or a calendar date ("2026-09-28", shown as is). */
export type When = number | string;

const isoOf = (when: When) => (typeof when === "number" ? nyDate(when) : when);
const pad = (value: number) => String(value).padStart(2, "0");

/** "Sep", for "2026-09" or "2026-09-28". */
export const monthName = (date: string): string => MONTHS[Number(date.slice(5, 7)) - 1] ?? "";

/** "28 Sep". */
export function dayText(when: When): string {
  const iso = isoOf(when);
  return `${Number(iso.slice(8, 10))} ${monthName(iso)}`;
}

/** "28 Sep 2026". */
export const dayYearText = (when: When): string => `${dayText(when)} ${isoOf(when).slice(0, 4)}`;

/** "09:35", or "09:35:12" with seconds, on New York's clock. */
export function clockText(at: number, { seconds = false }: { seconds?: boolean } = {}): string {
  const minute = nyMinuteOfDay(at);
  const time = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
  // New York's offset is whole hours, so the seconds are UTC's.
  return seconds ? `${time}:${pad(new Date(at).getUTCSeconds())}` : time;
}

/** "28 Sep 09:35"; "28 Sep 2026 09:35" with `year`; "28 Sep 09:35:12" with `seconds`. */
export function dayTimeText(at: number, options: { year?: boolean; seconds?: boolean } = {}): string {
  return `${options.year ? dayYearText(at) : dayText(at)} ${clockText(at, options)}`;
}

/** "2026-09" → "Sep 2026", or "September 2026" with `long`. */
export function monthText(month: string, { long = false }: { long?: boolean } = {}): string {
  const name = long ? LONG_MONTHS[Number(month.slice(5, 7)) - 1] : monthName(month);
  return `${name} ${month.slice(0, 4)}`;
}

/** "2026-12-09" → "09/12/2026", as a date field shows it. */
export const fieldDate = (date: string): string =>
  `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const isoDate = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const real = (year: number, month: number, day: number) =>
  month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;
const DM = /^(\d{1,2})[/.-](\d{1,2})$/;

/** A typed date, day/month/year (spec §8.2): "9/12/26", "09.12.2026", "9-12-2026", or ISO. Null if it isn't one. */
export function parseDayMonthYear(text: string): string | null {
  const trimmed = text.trim();
  const iso = ISO.exec(trimmed);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return real(year, month, day) ? isoDate(year, month, day) : null;
  }
  const typed = DMY.exec(trimmed);
  if (!typed) return null;
  const [day, month] = [Number(typed[1]), Number(typed[2])];
  const yearText = typed[3] ?? "";
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  return real(year, month, day) ? isoDate(year, month, day) : null;
}

/** A day and month with no year ("9/12"): the latest such date on or before `today`, as the palette reads it. */
export function parseDayMonth(text: string, today: string): string | null {
  const typed = DM.exec(text.trim());
  if (!typed) return null;
  const [day, month] = [Number(typed[1]), Number(typed[2])];
  const thisYear = Number(today.slice(0, 4));
  // Eight years back reaches the last 29 February.
  for (let year = thisYear; year >= thisYear - 8; year -= 1) {
    if (!real(year, month, day)) continue;
    const date = isoDate(year, month, day);
    if (date <= today) return date;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests; they pass.** Then `pnpm format`, `pnpm lint`, `pnpm typecheck`.
- [ ] **Step 5: Commit:** `feat(core): dateText, every date the European way`.

### Task 2: every date shown goes through `dateText`, with a guard test

**Files:**
- Create: `packages/core/src/dateText.guard.test.ts`
- Modify: every file in the table in Step 3, and the tests whose expected text was a US date (Step 5)

**Interfaces:**
- Consumes: Task 1's helpers.
- Produces:
  - `chartTimeIso(time: Time): string | null` in `apps/web/src/chart/style.ts`;
  - `nyTickLabel` (`apps/web/src/analytics/equityData.ts`), same signature, no Intl;
  - `nyTimeText` (`chart/style.ts`) and `etMinute` (`moves.ts`) kept as one-line wrappers so their callers don't change.

- [ ] **Step 1: Write the guard test** (`packages/core/src/dateText.guard.test.ts`):

```ts
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
const FORMATTER = /DateTimeFormat\(|toLocaleDateString|toLocaleTimeString|new Date\([^)]*\)\.toLocaleString\(/;

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
```

- [ ] **Step 2: Run it; it fails** and lists the files: `pnpm --filter @tj/core exec vitest run src/dateText.guard.test.ts`.
- [ ] **Step 3: Replace each formatter.** Delete each `Intl.DateTimeFormat` constant once it's unused, and import the helpers from `@tj/core`:

| File | Now | Becomes |
|---|---|---|
| `apps/web/src/analytics/EquityCurve.tsx` | `NY_TIME` + `nyText` crosshair ("Sep 28, 2026, 09:35 AM") | `timeFormatter: (time: Time) => typeof time === "number" ? dayTimeText(time * 1000, { year: true }) : String(time)`; delete `NY_TIME` and `nyText` |
| `apps/web/src/analytics/Sparkline.tsx` | `ET_DAY.format(new Date(point.closedAt))` | `dayText(point.closedAt)` |
| `apps/web/src/analytics/search.ts` `periodLabel` | week "Sep 22 – Sep 26, 2026"; month "September 2026" | week `` `${dayText(from)} – ${dayText(to)} ${to.slice(0, 4)}` `` ("22 Sep – 26 Sep 2026"); month `monthText(at.slice(0, 7), { long: true })`; delete `MONTH_YEAR`, `MONTH_DAY` and `utc` if unused |
| `apps/web/src/analytics/equityData.ts` `nyTickLabel` | `TICK_FORMATS` | the switch below |
| `apps/web/src/analytics/Charts.tsx` | `NY_DAY.format(…)` | `dayText(point.closedAt)` |
| `apps/web/src/analytics/SetupCards.tsx` `lastText` | `ET_DAY` / `ET_DAY_YEAR` | `nyDate(closedAt).slice(0, 4) === today.slice(0, 4) ? dayText(closedAt) : dayYearText(closedAt)`; doc comment "28 Sep", "17 Sep 2025" |
| `apps/web/src/routes/FillsPanel.tsx` `fillTime` | parts → "Sep 28 09:31:05" | `dayTimeText(at, { seconds: true })` |
| `apps/web/src/moves.ts` `etMinute` | parts → "Sep 9 15:54" | `export const etMinute = (at: number) => dayTimeText(at);` ("9 Sep 15:54") |
| `apps/web/src/settle.ts` `dayText` | `toLocaleDateString` | delete the local function; `settle.ts` itself, `SettlePanel.tsx` and `EditTrade.tsx` import `dayText` from `@tj/core` |
| `apps/web/src/missed/text.ts` `dayText` | `DAY.format` | delete the local function; `text.ts` itself (if it uses it), `MissedWorkspace.tsx` (`dayText`) and `NewMissed.tsx` (`dayText as dayName`) import it from `@tj/core` |
| `apps/web/src/routes/ScalpTiles.tsx` `expiryText` | `toLocaleDateString` | delete; use `dayText(expiry)` |
| `apps/web/src/components/Estimate.tsx` `quotedAtText` | `ET` (12-hour) | `` `${dayTimeText(at)} ET` `` |
| `apps/web/src/routes/OverviewTab.tsx` | `ET_DAY.format(…)` | `dayText(trade.closedAt)` |
| `apps/web/src/routes/IbkrCard.tsx` `when` | `ET.format` | `dayTimeText(at)` |
| `apps/web/src/routes/Journal.tsx` | `ET.format(…)` twice (12-hour) | `dayTimeText(…)` |
| `apps/web/src/routes/ChainPickers.tsx` `expiryLabel` | "Oct 2 · Fri · 6d" | `` `${dayText(expiration.date)} · ${weekdayOfDate(expiration.date)} · …` `` ("2 Oct · Fri · 6d"); delete `MONTH_DAY` and `WEEKDAY` |
| `apps/web/src/chart/style.ts` | `NY_TIME`; daily crosshair `String(time)` | `export const nyTimeText = (t: number) => dayTimeText(t);` plus the business-day handling below |
| `apps/web/src/chart/option.ts` | `EXPIRY` in `contractName`; local `clockText` | `` `${trade.underlying} ${leg.strike}${leg.right} ${dayText(leg.expiry)}` ``; delete the local `clockText` and `pad`, and import `clockText` from `@tj/core` here and in `chart/context.ts` (`rg -l "clockText" apps/web/src` finds every importer) |
| `apps/web/src/routes/Dashboard.tsx` | `ET_DAY`, `ET_TIME`, `MONTH_TITLE` | `dayText(…)`, `dayTimeText(…)`, `monthText(month)` |
| `apps/web/src/routes/Import.tsx` `when` | `toLocaleString` | `epochMs == null ? "—" : dayTimeText(epochMs)` |
| `apps/web/src/routes/TradeDetail.tsx` | `ET.format` twice (12-hour) | `dayTimeText(…)` |
| `apps/web/src/missed/MissedPage.tsx` | `ET.format` | `dayTimeText(…)` |
| `apps/web/src/missed/MissedWorkspace.tsx` header | `toLocaleDateString` | `dayText(trade.openedAt)` |
| `packages/core/src/splits.ts` `monthLabel` | `MONTH.format` | `export const monthLabel = (month: string) => monthText(month);`, importing from `./dateText.js` |
| `packages/db/src/repositories/trades.ts` | `ET_DAY.format(new Date(openedAt))` in "The exit must be on the entry's day, …" | `dayText(openedAt)`, so "…, 30 Sep" |

**The equity chart's ticks** (`equityData.ts`), replacing `ny` and `TICK_FORMATS`:

```ts
/**
 * A time-axis label in New York time, at the detail Lightweight Charts asks for: a year, a month, a day or a
 * time of day. One day label for every tick repeated "1 Sep" for two closes on the same day.
 */
export function nyTickLabel(seconds: number, type: TickMarkType): string {
  const at = seconds * 1000;
  switch (type) {
    case TickMarkType.Year:
      return nyDate(at).slice(0, 4);
    case TickMarkType.Month:
      return monthName(nyDate(at));
    case TickMarkType.DayOfMonth:
      return dayText(at);
    case TickMarkType.Time:
      return clockText(at);
    case TickMarkType.TimeWithSeconds:
      return clockText(at, { seconds: true });
  }
}
```

**The daily chart's business days** (`chart/style.ts`). A daily bar's time is `"2026-09-28"` or `{ year, month, day }`. Add the helper and use it in both formatters:

```ts
/** A chart time as a New York date: an intraday time read in New York, a daily bar's business day as is. */
export function chartTimeIso(time: Time): string | null {
  if (typeof time === "number") return nyDate(time * 1000);
  if (typeof time === "string") return time;
  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
}
```

In `chartOptions`:

```ts
      tickMarkFormatter: (time: Time, type: TickMarkType) => {
        if (typeof time === "number") return nyTickLabel(time, type);
        const iso = chartTimeIso(time);
        if (iso == null) return null;
        if (type === TickMarkType.Year) return iso.slice(0, 4);
        return type === TickMarkType.Month ? monthName(iso) : dayText(iso);
      },
    },
    localization: {
      timeFormatter: (time: Time) =>
        typeof time === "number" ? nyTimeText(time * 1000) : dayYearText(chartTimeIso(time) ?? ""),
    },
```

Update the comment above `tickMarkFormatter`: the daily chart is no longer left to the library, so its labels don't follow the browser's language.

- [ ] **Step 4: Run the guard test; it passes:** `pnpm --filter @tj/core exec vitest run src/dateText.guard.test.ts`.
- [ ] **Step 5: Update the tests that expected US dates.**
  - **Find them:** `rg -l "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]|[0-9] (AM|PM)" apps packages --glob "*.test.ts*"`. Then run `pnpm test`, and fix every failure whose expected text is a date.
  - **The rules:**
    - "Sep 28" → "28 Sep";
    - "Sep 28, 2026" → "28 Sep 2026";
    - "Sep 28, 09:35 AM" and "Sep 28, 09:35" → "28 Sep 09:35";
    - "Sep 22 – Sep 26, 2026" → "22 Sep – 26 Sep 2026";
    - "NVDA 232.5C Sep 26" → "NVDA 232.5C 26 Sep";
    - "Oct 2 · Fri · 6d" → "2 Oct · Fri · 6d".
  - Never loosen an assertion: a `toBe` stays a `toBe`. A failure that isn't about a date's text is a bug in Step 3, not in the test.
  - **Add one test in `chart/style.test.ts`** (create it if missing): `chartOptions(false).localization.timeFormatter("2026-09-28")` → "28 Sep 2026", and `({ year: 2026, month: 9, day: 28 })` → "28 Sep 2026".
- [ ] **Step 6:** `pnpm format`, `pnpm lint`, `pnpm typecheck`, then `pnpm test`. All pass.
- [ ] **Step 7: Commit:** `feat: every date shown day first (28 Sep 2026), with a guard against US formatters`.

### Task 3: `DateField` replaces the browser's date inputs

**Files:**
- Create: `apps/web/src/components/DateField.tsx`, `apps/web/src/components/DateField.test.tsx`
- Modify: `apps/web/src/routes/IbkrSettings.tsx:105-111`, `apps/web/src/routes/Analytics.tsx:147-160`, `apps/web/src/missed/MissedPage.tsx:297-303`, and their tests (`IbkrSettings.test.tsx`, `Analytics.test.tsx`, `BookMissed.test.tsx` / `MissedPage` tests that set a date)

**Interfaces:**
- Consumes: `fieldDate` and `parseDayMonthYear` (Task 1).
- Produces: `DateField({ label, value, onChange, className? })`. `value` is ISO or `""`, and `onChange(date)` receives ISO or `""`.

- [ ] **Step 1: Write the tests** (`DateField.test.tsx`):

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateField } from "./DateField.js";

function Form({ initial, onSubmitted }: { initial: string; onSubmitted: (date: string) => void }) {
  const [date, setDate] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitted(date);
      }}
    >
      <DateField label="Date" value={date} onChange={setDate} />
    </form>
  );
}

const field = () => screen.getByRole("textbox", { name: "Date" }) as HTMLInputElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

afterEach(() => vi.restoreAllMocks());

describe("DateField", () => {
  it("shows the date day first", () => {
    render(<DateField label="Date" value="2026-12-09" onChange={() => {}} />);
    expect(field().value).toBe("09/12/2026");
  });

  it("reads 9/12/26 as 9 December 2026 on blur, and tidies the text", () => {
    const onChange = vi.fn();
    render(<DateField label="Date" value="" onChange={onChange} />);
    type("9/12/26");
    fireEvent.blur(field());
    expect(onChange).toHaveBeenCalledWith("2026-12-09");
    expect(field().value).toBe("09/12/2026");
  });

  it("submits its form on Enter with the date just typed", () => {
    const onSubmitted = vi.fn();
    render(<Form initial="2026-09-28" onSubmitted={onSubmitted} />);
    type("9.12.26");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmitted).toHaveBeenCalledWith("2026-12-09");
  });

  it("keeps a bad date with its message, changes nothing, and doesn't submit", () => {
    const onSubmitted = vi.fn();
    render(<Form initial="2026-09-28" onSubmitted={onSubmitted} />);
    type("9/28/2026");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Not a date: day/month/year");
    expect(field().value).toBe("9/28/2026");
    fireEvent.blur(field());
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("clears to an empty date", () => {
    const onChange = vi.fn();
    render(<DateField label="Date" value="2026-12-09" onChange={onChange} />);
    type("");
    fireEvent.blur(field());
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("opens the browser's picker, and a pick fills the field", () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", { value: showPicker, configurable: true });
    const onChange = vi.fn();
    const { container } = render(<DateField label="Date" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick date" }));
    expect(showPicker).toHaveBeenCalledOnce();
    const native = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(native, { target: { value: "2026-12-24" } });
    expect(onChange).toHaveBeenCalledWith("2026-12-24");
  });

  it("shows a new value from outside", () => {
    const { rerender } = render(<DateField label="Date" value="2026-12-09" onChange={() => {}} />);
    rerender(<DateField label="Date" value="2026-12-24" onChange={() => {}} />);
    expect(field().value).toBe("24/12/2026");
  });
});
```

- [ ] **Step 2: Run them; they fail:** `pnpm --filter @tj/web exec vitest run src/components/DateField.test.tsx`.
- [ ] **Step 3: Implement `DateField.tsx`:**

```tsx
import { fieldDate, parseDayMonthYear } from "@tj/core";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * A date typed day/month/year (launcher-keys-palette spec §8.2). It shows 09/12/2026 whatever the browser's
 * language, reads 9/12/26, 9.12.26, 9-12-2026 or ISO, and commits on Enter or blur. 📅 opens the browser's picker.
 */
export function DateField({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  /** ISO ("2026-12-09"), or "" for none. */
  value: string;
  onChange: (date: string) => void;
  className?: string;
}) {
  const shown = value ? fieldDate(value) : "";
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // A value from outside (a pick, a preset, a save) replaces what's shown.
  useEffect(() => {
    setText(shown);
    setBad(false);
  }, [shown]);

  /** The typed date, or "" when empty; null when it isn't a date, which keeps the text and the value. */
  const commit = (): string | null => {
    const date = text.trim() === "" ? "" : parseDayMonthYear(text);
    if (date === null) {
      setBad(true);
      return null;
    }
    setBad(false);
    setText(date ? fieldDate(date) : "");
    if (date !== value) onChange(date);
    return date;
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        aria-label={label}
        aria-invalid={bad || undefined}
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setBad(false);
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          // Commit first and let the form see the new date; a bad date doesn't submit.
          event.preventDefault();
          const form = event.currentTarget.form;
          const result = { date: null as string | null };
          flushSync(() => {
            result.date = commit();
          });
          if (result.date !== null) form?.requestSubmit();
        }}
        className={`num w-24 ${className}`}
      />
      <button
        type="button"
        aria-label={`Pick ${label.toLowerCase()}`}
        onClick={() => picker.current?.showPicker?.()}
        className="text-muted hover:text-fg"
      >
        📅
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
        className="pointer-events-none absolute h-px w-px opacity-0"
      />
      {bad && (
        <span role="alert" className="text-[11px] text-down">
          Not a date: day/month/year
        </span>
      )}
    </span>
  );
}
```

The hidden native field stays rendered (a 1 px transparent box), because `showPicker()` refuses a `display: none` field. Give its nearest wrapper `relative` if the picker pops up in the wrong place in the live check.

- [ ] **Step 4: Run the tests; they pass.**
- [ ] **Step 5: Use it in the four places:**
  - `IbkrSettings.tsx`: `<DateField label="Start date" value={since} onChange={setSince} className={INPUT} />`, in place of the `<input type="date">` inside the existing `<label>`. The label wraps two controls now, so change that `<label>` to a `<div>` with the same class.
  - `Analytics.tsx`:
    - `<DateField label="From" value={search.from ?? ""} onChange={(date) => onSearch({ from: date || undefined })} className={INPUT} />`;
    - the same for To.
  - `MissedPage.tsx`: `<DateField label="Date" value={date} onChange={setDate} className="rounded-sm border border-line bg-[#0e1118] px-1.5 py-0.5 text-fg outline-none focus:border-accent" />`, inside the existing `<label>`, changed to a `<div>` with the same class.
- [ ] **Step 6: Update those pages' tests.** Each one that set a date with `fireEvent.change(dateInput, { target: { value: "2026-09-29" } })` now types `"29/09/2026"` into `getByRole("textbox", { name: … })` and blurs it, or presses Enter where it then submits. Find them: `rg -n 'type="date"|name: "(Start date|From|To|Date)"' apps/web/src --glob "*.test.tsx"`.
- [ ] **Step 7:** `pnpm format`, `pnpm lint`, `pnpm typecheck`, then `pnpm --filter @tj/web exec vitest run`. All pass.
- [ ] **Step 8: Commit:** `feat(web): a date field typed day/month/year, in place of the browser's`.

---

## Part B — The launcher (spec §3)

### Task 4: server — health names the app and process, and `POST /api/shutdown` stops it after the requests in flight

**Files:**
- Create: `apps/server/src/stop.ts`, `apps/server/src/stop.test.ts`, `apps/server/src/shutdown.test.ts`
- Modify: `apps/server/src/app.ts` (`AppDeps`, the health route, the new route), `apps/server/src/index.ts`, `apps/server/src/app.test.ts:63-66` (the health expectation)

**Interfaces (produces):**
```ts
// app.ts, AppDeps
pid?: number;            // in /api/health
shutdown?: () => void;   // without it, POST /api/shutdown answers 404
// GET /api/health → { ok: true, app: "trading-journal", pid: number | null }
// POST /api/shutdown → 200 { ok: true } (then deps.shutdown runs) | 404 { error: "not found" }
// stop.ts
export function stopWhenIdle(server: import("node:http").Server, done: () => void, everyMs?: number): void;
```

- [ ] **Step 1: Write the tests.**

`shutdown.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { LOCAL, testApp } from "./testing.js";

describe("health and shutdown", () => {
  it("names the app and its process", async () => {
    const res = await testApp({ pid: 4242 }).request("/api/health", { headers: LOCAL });
    expect(await res.json()).toEqual({ ok: true, app: "trading-journal", pid: 4242 });
  });

  it("answers, then stops once", async () => {
    const shutdown = vi.fn();
    const app = testApp({ shutdown });
    const res = await app.request("/api/shutdown", { method: "POST", headers: LOCAL });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());
  });

  it("isn't there without a way to stop", async () => {
    const res = await testApp().request("/api/shutdown", { method: "POST", headers: LOCAL });
    expect(res.status).toBe(404);
  });

  it("refuses another site", async () => {
    const shutdown = vi.fn();
    const res = await testApp({ shutdown }).request("/api/shutdown", {
      method: "POST",
      headers: { ...LOCAL, "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shutdown).not.toHaveBeenCalled();
  });
});
```

`stop.test.ts`:

```ts
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { stopWhenIdle } from "./stop.js";

describe("stopWhenIdle", () => {
  it("lets a request in flight finish, then stops and calls done", async () => {
    const server = createServer((_req, res) => {
      setTimeout(() => res.end("done"), 300);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const reply = fetch(`http://127.0.0.1:${port}/`).then((res) => res.text());
    await new Promise((resolve) => setTimeout(resolve, 50));
    const done = vi.fn();
    stopWhenIdle(server, done, 20);
    expect(await reply).toBe("done");
    await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });
});
```

In `app.test.ts`, the "answers health checks" test expects `{ ok: true, app: "trading-journal", pid: null }`.

- [ ] **Step 2: Run them; they fail:** `pnpm --filter @tj/server exec vitest run src/shutdown.test.ts src/stop.test.ts src/app.test.ts`.
- [ ] **Step 3: Implement.**

`stop.ts`:

```ts
import type { Server } from "node:http";

/**
 * Stops taking connections and calls `done` once the requests in flight have ended (launcher spec §3.3), so a sync
 * or a merge is never cut off. The open page's keep-alive connections would hold `close()` open, so idle ones are
 * closed now and again until it ends.
 */
export function stopWhenIdle(server: Server, done: () => void, everyMs = 250): void {
  const timer = setInterval(() => server.closeIdleConnections(), everyMs);
  server.close(() => {
    clearInterval(timer);
    done();
  });
  server.closeIdleConnections();
}
```

In `app.ts`, add to `AppDeps`:

```ts
  /** This process's id, in /api/health so the launcher knows the server it started (launcher spec §3.3). */
  pid?: number;
  /** Stops the server once the requests in flight end (launcher spec §3.4). Without it, /api/shutdown is a 404. */
  shutdown?: () => void;
```

Replace the health route, and add the shutdown route right after it (inside the same chain, so `AppType` has it):

```ts
    .get("/api/health", (c) => c.json({ ok: true, app: "trading-journal", pid: deps.pid ?? null }))
    .post("/api/shutdown", (c) => {
      const stop = deps.shutdown;
      if (!stop) return c.json({ error: "not found" }, 404);
      // After this answer goes out: the stop waits for the requests in flight, this one included.
      setTimeout(stop, 0);
      return c.json({ ok: true });
    })
```

In `index.ts`:
- import `type Server` from `node:http` and `stopWhenIdle` from `./stop.js`;
- declare `let server: Server | undefined;` before `createApp`;
- pass `pid: process.pid` and this `shutdown` to `createApp`:

```ts
  shutdown: () => {
    console.log("Stopping: the requests in flight finish first.");
    if (server) stopWhenIdle(server, () => process.exit(0));
  },
```

Then `server = serve({ … }, () => { … }) as Server;`. `pnpm demo` runs `index.ts` too, so it gets both.

- [ ] **Step 4: Run the tests; they pass.** `pnpm typecheck` checks that `api.api.shutdown.$post` exists for the web app.
- [ ] **Step 5: Commit:** `feat(server): health names the app and process; POST /api/shutdown waits for requests in flight`.

### Task 5: the launcher's decisions, lock and error page

**Files:**
- Create: `apps/server/src/launch/click.ts`, `lock.ts`, `errorPage.ts`, and `click.test.ts`, `lock.test.ts`, `errorPage.test.ts` beside them

**Interfaces (produces):**
```ts
// click.ts
export type Probe = { kind: "journal"; pid: number | null } | { kind: "other" } | { kind: "down" };
export interface LaunchState { pid: number; head: string | null; port: number; startedAt: number }
export interface UpdateResult { ok: boolean; output: string }
export interface ClickEffects {
  probe(): Promise<Probe>;
  head(): Promise<string | null>;
  readState(): LaunchState | null;
  writeState(state: LaunchState): void;
  stop(): Promise<boolean>;
  update(): Promise<UpdateResult>;
  start(): number;
  waitUp(pid: number): Promise<boolean>;
  openBrowser(): void;
  now(): number;
}
export type ClickOutcome = { kind: "opened"; started: boolean; restarted: boolean } | { kind: "failed"; failure: Failure };
export function click(fx: ClickEffects, port: number): Promise<ClickOutcome>;
// lock.ts
export function isAlive(pid: number): boolean;
export function takeLock(file: string, now: number, alive?: (pid: number) => boolean, pid?: number): boolean;
export function releaseLock(file: string): void;
// errorPage.ts
export type Failure =
  | { kind: "port-taken"; port: number }
  | { kind: "update-failed"; output: string }
  | { kind: "not-started" }
  | { kind: "still-busy" }
  | { kind: "tool-missing"; path: string };
export function failureReason(failure: Failure): string;
export function tail(text: string, count?: number): string;
export function errorPage(failure: Failure, log: string): string;
```

- [ ] **Step 1: Write the tests.**

`click.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type ClickEffects, click, type LaunchState } from "./click.js";

function fakes(overrides: Partial<ClickEffects> = {}) {
  const calls: string[] = [];
  const fx: ClickEffects = {
    probe: async () => ({ kind: "down" }),
    head: async () => "abc",
    readState: () => null,
    writeState: (state) => {
      calls.push(`write ${state.pid} ${state.head}`);
    },
    stop: async () => {
      calls.push("stop");
      return true;
    },
    update: async () => {
      calls.push("update");
      return { ok: true, output: "" };
    },
    start: () => {
      calls.push("start");
      return 777;
    },
    waitUp: async (pid) => {
      calls.push(`wait ${pid}`);
      return true;
    },
    openBrowser: () => {
      calls.push("open");
    },
    now: () => 1000,
    ...overrides,
  };
  return { fx, calls };
}
const ours = (head: string | null): LaunchState => ({ pid: 55, head, port: 4178, startedAt: 1 });
const up = async () => ({ kind: "journal" as const, pid: 55 });

describe("a click", () => {
  it("starts a journal that's down, then opens the browser", async () => {
    const { fx, calls } = fakes();
    expect(await click(fx, 4178)).toEqual({ kind: "opened", started: true, restarted: false });
    expect(calls).toEqual(["update", "start", "write 777 abc", "wait 777", "open"]);
  });

  it("only opens the browser when the journal is up on the same commit", async () => {
    const { fx, calls } = fakes({ probe: up, readState: () => ours("abc") });
    expect(await click(fx, 4178)).toEqual({ kind: "opened", started: false, restarted: false });
    expect(calls).toEqual(["open"]);
  });

  it("restarts a server it started on an older commit", async () => {
    const { fx, calls } = fakes({ probe: up, readState: () => ours("old") });
    expect(await click(fx, 4178)).toEqual({ kind: "opened", started: true, restarted: true });
    expect(calls).toEqual(["stop", "update", "start", "write 777 abc", "wait 777", "open"]);
  });

  it.each([
    ["it didn't start it", () => null, async () => "abc"],
    ["there's no git", () => ours("old"), async () => null],
  ])("leaves a running journal alone when %s", async (_, readState, head) => {
    const { fx, calls } = fakes({ probe: up, readState, head });
    await click(fx, 4178);
    expect(calls).toEqual(["open"]);
  });

  it("leaves alone a journal that doesn't give its process", async () => {
    const { fx, calls } = fakes({ probe: async () => ({ kind: "journal", pid: null }), readState: () => ours("old") });
    await click(fx, 4178);
    expect(calls).toEqual(["open"]);
  });

  it("fails when another program has the port", async () => {
    const { fx, calls } = fakes({ probe: async () => ({ kind: "other" }) });
    expect(await click(fx, 4199)).toEqual({ kind: "failed", failure: { kind: "port-taken", port: 4199 } });
    expect(calls).toEqual([]);
  });

  it("fails when the update fails, without starting", async () => {
    const { fx, calls } = fakes({ update: async () => ({ ok: false, output: "ERR_PNPM_OUTDATED_LOCKFILE" }) });
    expect(await click(fx, 4178)).toEqual({
      kind: "failed",
      failure: { kind: "update-failed", output: "ERR_PNPM_OUTDATED_LOCKFILE" },
    });
    expect(calls).toEqual([]);
  });

  it("fails when the server doesn't come up", async () => {
    const { fx } = fakes({ waitUp: async () => false });
    expect(await click(fx, 4178)).toEqual({ kind: "failed", failure: { kind: "not-started" } });
  });

  it("fails when the old server is still busy, without updating", async () => {
    const { fx, calls } = fakes({ probe: up, readState: () => ours("old"), stop: async () => false });
    expect(await click(fx, 4178)).toEqual({ kind: "failed", failure: { kind: "still-busy" } });
    expect(calls).toEqual([]);
  });
});
```

`lock.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAlive, releaseLock, takeLock } from "./lock.js";

const lockIn = () => join(mkdtempSync(join(tmpdir(), "tj-lock-")), "launch.lock");
const alive = () => true;

describe("the click's lock", () => {
  it("is taken when free, with this process in it", () => {
    const file = lockIn();
    expect(takeLock(file, 1000, alive, 31)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ pid: 31, at: 1000 });
  });

  it("is refused while another click holds it", () => {
    const file = lockIn();
    takeLock(file, 1000, alive, 31);
    expect(takeLock(file, 30_000, alive, 32)).toBe(false);
  });

  it("is taken over after a minute", () => {
    const file = lockIn();
    takeLock(file, 1000, alive, 31);
    expect(takeLock(file, 62_000, alive, 32)).toBe(true);
  });

  it("is taken over when its process is gone", () => {
    const file = lockIn();
    takeLock(file, 1000, alive, 31);
    expect(takeLock(file, 2000, () => false, 32)).toBe(true);
  });

  it("is taken over when it can't be read", () => {
    const file = lockIn();
    writeFileSync(file, "garbage");
    expect(takeLock(file, 1000, alive, 32)).toBe(true);
  });

  it("is free again once released", () => {
    const file = lockIn();
    takeLock(file, 1000, alive, 31);
    releaseLock(file);
    releaseLock(file);
    expect(takeLock(file, 1500, alive, 32)).toBe(true);
  });

  it("knows this process is alive", () => {
    expect(isAlive(process.pid)).toBe(true);
  });
});
```

`errorPage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { errorPage, failureReason, tail } from "./errorPage.js";

describe("the error page", () => {
  it.each([
    [
      { kind: "port-taken" as const, port: 4178 },
      "Port 4178 is used by another program. Close it, or set TJ_PORT and run `pnpm launcher:install` again.",
    ],
    [{ kind: "update-failed" as const, output: "" }, "Updating the journal failed"],
    [{ kind: "not-started" as const }, "The journal didn't start"],
    [
      { kind: "still-busy" as const },
      "The journal is finishing a sync before it restarts with your update. Click the icon again in a minute.",
    ],
    [
      { kind: "tool-missing" as const, path: "/opt/pnpm" },
      "Node (or pnpm) is no longer at /opt/pnpm. Run `pnpm launcher:install` again.",
    ],
  ])("says why: %o", (failure, reason) => {
    expect(failureReason(failure)).toBe(reason);
  });

  it("keeps the last 40 lines", () => {
    const log = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(tail(`${log}\n`).split("\n")).toEqual(Array.from({ length: 40 }, (_, i) => `line ${i + 11}`));
  });

  it("shows the log's end, escaped, and the update's own output when that failed", () => {
    const page = errorPage({ kind: "not-started" }, "Error: <boom> & more");
    expect(page).toContain("<h1>The journal didn't start</h1>");
    expect(page).toContain("Error: &lt;boom&gt; &amp; more");
    expect(page).toContain("pnpm start");
    const update = errorPage({ kind: "update-failed", output: "ERR_PNPM" }, "server log");
    expect(update).toContain("ERR_PNPM");
    expect(update).not.toContain("server log");
  });
});
```

- [ ] **Step 2: Run them; they fail:** `pnpm --filter @tj/server exec vitest run src/launch`.
- [ ] **Step 3: Implement.**

`errorPage.ts`:

```ts
/** Why a click didn't open the journal (launcher spec §3.5). */
export type Failure =
  | { kind: "port-taken"; port: number }
  | { kind: "update-failed"; output: string }
  | { kind: "not-started" }
  | { kind: "still-busy" }
  | { kind: "tool-missing"; path: string };

export function failureReason(failure: Failure): string {
  switch (failure.kind) {
    case "port-taken":
      return `Port ${failure.port} is used by another program. Close it, or set TJ_PORT and run \`pnpm launcher:install\` again.`;
    case "update-failed":
      return "Updating the journal failed";
    case "not-started":
      return "The journal didn't start";
    case "still-busy":
      return "The journal is finishing a sync before it restarts with your update. Click the icon again in a minute.";
    case "tool-missing":
      return `Node (or pnpm) is no longer at ${failure.path}. Run \`pnpm launcher:install\` again.`;
  }
}

/** What to try when the reason doesn't already say. */
const HINT: Partial<Record<Failure["kind"], string>> = {
  "update-failed": "Run `pnpm start` in the journal's folder to see the whole output.",
  "not-started": "Run `pnpm start` in the journal's folder to see the whole output.",
};

/** The last `count` lines of a text, without its final newline. */
export function tail(text: string, count = 40): string {
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  return lines.slice(-count).join("\n");
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);

/** The page a failed click opens: the reason, what to try, and the last lines of the update's output or the log. */
export function errorPage(failure: Failure, log: string): string {
  const lines = tail(failure.kind === "update-failed" ? failure.output : log);
  const hint = HINT[failure.kind];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Trading Journal didn't open</title>
<style>
body { background: #0b0e14; color: #d1d4dc; font: 14px/1.5 system-ui, sans-serif; margin: 40px; }
h1 { font-size: 18px; }
pre { background: #131722; border: 1px solid #1f2430; padding: 12px; overflow: auto; font: 12px/1.4 ui-monospace, monospace; color: #8a91a3; }
</style>
</head>
<body>
<h1>${escape(failureReason(failure))}</h1>
${hint ? `<p>${escape(hint)}</p>` : ""}
${lines ? `<p>The last lines:</p>\n<pre>${escape(lines)}</pre>` : ""}
</body>
</html>
`;
}
```

`lock.ts`:

```ts
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

const STALE_MS = 60_000;

/** Whether a process is still running: signal 0 checks without sending anything. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const create = (file: string, body: string) => {
  try {
    writeFileSync(file, body, { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
};

/**
 * Takes the click's lock (launcher spec §3.2): created exclusively, so a second click while the first starts the
 * journal gets false. A lock older than a minute, unreadable, or whose process is gone is stale and taken over.
 */
export function takeLock(file: string, now: number, alive = isAlive, pid = process.pid): boolean {
  const body = JSON.stringify({ pid, at: now });
  if (create(file, body)) return true;
  let held: { pid?: unknown; at?: unknown } = {};
  try {
    held = JSON.parse(readFileSync(file, "utf8")) as typeof held;
  } catch {
    // Unreadable: stale.
  }
  const fresh =
    typeof held.at === "number" && now - held.at < STALE_MS && typeof held.pid === "number" && alive(held.pid);
  if (fresh) return false;
  releaseLock(file);
  return create(file, body);
}

export function releaseLock(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // Already gone.
  }
}
```

`click.ts`:

```ts
import type { Failure } from "./errorPage.js";

/** What answers on the journal's port. */
export type Probe = { kind: "journal"; pid: number | null } | { kind: "other" } | { kind: "down" };

/** What the launcher remembers about the server it started: `<data dir>/launcher.json`. */
export interface LaunchState {
  pid: number;
  head: string | null;
  port: number;
  startedAt: number;
}

export interface UpdateResult {
  ok: boolean;
  output: string;
}

/** Everything a click does to the world, so its decisions can be tested (launcher spec §3.2). */
export interface ClickEffects {
  probe(): Promise<Probe>;
  /** `git rev-parse HEAD`, or null without git. */
  head(): Promise<string | null>;
  readState(): LaunchState | null;
  writeState(state: LaunchState): void;
  /** Asks the server to stop and waits up to 10 s for the port to free; false if it's still busy. */
  stop(): Promise<boolean>;
  /** `pnpm install --frozen-lockfile`, then `pnpm build`. */
  update(): Promise<UpdateResult>;
  /** Starts the server in the background; its process id. */
  start(): number;
  /** Polls health for up to 30 s until that process answers; false if it exits or time runs out. */
  waitUp(pid: number): Promise<boolean>;
  openBrowser(): void;
  now(): number;
}

export type ClickOutcome =
  | { kind: "opened"; started: boolean; restarted: boolean }
  | { kind: "failed"; failure: Failure };

const failed = (failure: Failure): ClickOutcome => ({ kind: "failed", failure });

/**
 * One click on the icon (launcher spec §3.2): open a running journal, restart one the launcher started on an older
 * commit, or update, start and open one that's down.
 */
export async function click(fx: ClickEffects, port: number): Promise<ClickOutcome> {
  const found = await fx.probe();
  if (found.kind === "other") return failed({ kind: "port-taken", port });
  let restarted = false;
  if (found.kind === "journal") {
    const state = fx.readState();
    const head = await fx.head();
    const ours = state != null && found.pid != null && state.pid === found.pid;
    if (!ours || head == null || state.head === head) {
      fx.openBrowser();
      return { kind: "opened", started: false, restarted: false };
    }
    if (!(await fx.stop())) return failed({ kind: "still-busy" });
    restarted = true;
  }
  const update = await fx.update();
  if (!update.ok) return failed({ kind: "update-failed", output: update.output });
  const pid = fx.start();
  fx.writeState({ pid, head: await fx.head(), port, startedAt: fx.now() });
  if (!(await fx.waitUp(pid))) return failed({ kind: "not-started" });
  fx.openBrowser();
  return { kind: "opened", started: true, restarted };
}
```

- [ ] **Step 4: Run the tests; they pass.**
- [ ] **Step 5: Commit:** `feat(server): the launcher's decisions, lock and error page`.

### Task 6: the launcher's real effects, entry point, and an end-to-end start and stop

**Files:**
- Create: `apps/server/src/launch/effects.ts`, `args.ts`, `run.ts`, `main.ts`, and `effects.test.ts`, `args.test.ts`, `run.test.ts`, `start.e2e.test.ts`

**Interfaces:**
- Consumes: Task 4's health and shutdown, and Task 5's `click`, `takeLock`, `releaseLock`, `isAlive`, `errorPage` and `Failure`.
- Produces:

```ts
// args.ts
export interface LaunchArgs { pnpm: string; dataDir: string | null; port: number | null }
export function launchArgs(args: LaunchArgs): string[];         // the arguments after `node`
export function parseLaunchArgs(argv: readonly string[]): LaunchArgs; // process.argv.slice(2)
// effects.ts
export interface LaunchPaths { repo: string; dataDir: string; port: number; node: string; pnpm: string }
export const journalUrl: (port: number) => string;               // "http://127.0.0.1:4178/"
export const logFile: (dataDir: string) => string;               // <dataDir>/logs/server.log
export function probe(port: number, timeoutMs?: number): Promise<Probe>;
export function pollUntil(check: () => Promise<boolean>, timeoutMs: number, giveUp?: () => boolean, everyMs?: number): Promise<boolean>;
export function startServer(paths: Pick<LaunchPaths, "repo" | "dataDir" | "port" | "node">, env?: NodeJS.ProcessEnv): number;
export function browserCommand(url: string, platform: NodeJS.Platform): { command: string; args: string[]; verbatim: boolean };
export function openInBrowser(url: string, platform?: NodeJS.Platform): void;
export function realEffects(paths: LaunchPaths): ClickEffects;
// run.ts
export interface RunDeps { click: typeof click; effects: (paths: LaunchPaths) => ClickEffects; open: (url: string) => void; exists: (path: string) => boolean; now: () => number }
export function runLaunch(argv: readonly string[], env: NodeJS.ProcessEnv, deps?: Partial<RunDeps>): Promise<number>;
```

- [ ] **Step 1: Write the tests.**

`args.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { launchArgs, parseLaunchArgs } from "./args.js";

describe("the launcher's arguments", () => {
  it("run main.ts through tsx with what setup recorded", () => {
    expect(launchArgs({ pnpm: "/home/u/.local/bin/pnpm", dataDir: null, port: null })).toEqual([
      "--import",
      "tsx",
      "src/launch/main.ts",
      "--pnpm",
      "/home/u/.local/bin/pnpm",
    ]);
  });

  it("read back what they wrote", () => {
    const args = { pnpm: "C:\\pnpm\\pnpm.exe", dataDir: "D:\\journal data", port: 4300 };
    expect(parseLaunchArgs(launchArgs(args).slice(3))).toEqual(args);
    expect(parseLaunchArgs(["--pnpm", "/p"])).toEqual({ pnpm: "/p", dataDir: null, port: null });
  });
});
```

`effects.test.ts`:

```ts
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { browserCommand, journalUrl, pollUntil, probe } from "./effects.js";

async function serving(body: string | null) {
  const server = createServer((_req, res) => {
    if (body == null) return; // never answers
    res.setHeader("content-type", "application/json");
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

describe("the health probe", () => {
  it("knows the journal and its process", async () => {
    const { server, port } = await serving(JSON.stringify({ ok: true, app: "trading-journal", pid: 9 }));
    expect(await probe(port)).toEqual({ kind: "journal", pid: 9 });
    server.close();
  });

  it("takes an older journal's bare { ok: true } as the journal, with no process", async () => {
    const { server, port } = await serving(JSON.stringify({ ok: true }));
    expect(await probe(port)).toEqual({ kind: "journal", pid: null });
    server.close();
  });

  it("calls anything else on the port another program", async () => {
    const { server, port } = await serving("<html>hello</html>");
    expect(await probe(port)).toEqual({ kind: "other" });
    server.close();
  });

  it("calls a port that never answers another program", async () => {
    const { server, port } = await serving(null);
    expect(await probe(port, 200)).toEqual({ kind: "other" });
    server.closeAllConnections();
    server.close();
  });

  it("calls a closed port down", async () => {
    const { server, port } = await serving("{}");
    await new Promise((resolve) => server.close(resolve));
    expect(await probe(port)).toEqual({ kind: "down" });
  });
});

describe("the rest", () => {
  it("polls until a check passes, or gives up", async () => {
    let count = 0;
    expect(await pollUntil(async () => ++count === 3, 1000, () => false, 5)).toBe(true);
    expect(await pollUntil(async () => false, 1000, () => true, 5)).toBe(false);
  });

  it("opens the default browser on each system", () => {
    const url = journalUrl(4178);
    expect(url).toBe("http://127.0.0.1:4178/");
    expect(browserCommand(url, "linux")).toEqual({ command: "xdg-open", args: [url], verbatim: false });
    expect(browserCommand(url, "darwin")).toEqual({ command: "open", args: [url], verbatim: false });
    expect(browserCommand(url, "win32")).toEqual({
      command: "cmd",
      args: ["/c", `start "" "${url}"`],
      verbatim: true,
    });
  });
});
```

`run.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runLaunch } from "./run.js";

const dataDir = () => mkdtempSync(join(tmpdir(), "tj-run-"));
const argv = (dir: string) => ["--pnpm", "/bin/pnpm", "--data-dir", dir];
const base = { exists: () => true, now: () => 1000, effects: () => ({}) as never };

describe("runLaunch", () => {
  it("opens the error page when pnpm has moved", async () => {
    const dir = dataDir();
    const open = vi.fn();
    expect(await runLaunch(argv(dir), {}, { ...base, exists: () => false, open })).toBe(1);
    expect(readFileSync(join(dir, "launch-error.html"), "utf8")).toContain("Node (or pnpm) is no longer at /bin/pnpm");
    expect(open.mock.calls[0]?.[0]).toMatch(/^file:\/\/.*launch-error\.html$/);
  });

  it("releases the lock even when the click throws", async () => {
    const dir = dataDir();
    const click = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(runLaunch(argv(dir), {}, { ...base, click, open: vi.fn() })).rejects.toThrow("boom");
    expect(existsSync(join(dir, "launch.lock"))).toBe(false);
  });

  it("leaves the browser to a click already starting the journal", async () => {
    const dir = dataDir();
    const click = vi.fn(async () => ({ kind: "opened" as const, started: true, restarted: false }));
    const slow = runLaunch(argv(dir), {}, {
      ...base,
      open: vi.fn(),
      click: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { kind: "opened", started: true, restarted: false };
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await runLaunch(argv(dir), {}, { ...base, click, open: vi.fn() })).toBe(0);
    expect(click).not.toHaveBeenCalled();
    expect(await slow).toBe(0);
  });

  it("opens the error page for a failed click", async () => {
    const dir = dataDir();
    const open = vi.fn();
    const click = async () => ({ kind: "failed" as const, failure: { kind: "port-taken" as const, port: 4178 } });
    expect(await runLaunch(argv(dir), {}, { ...base, click, open })).toBe(1);
    expect(readFileSync(join(dir, "launch-error.html"), "utf8")).toContain("Port 4178 is used by another program");
  });
});
```

`start.e2e.test.ts` (a real server; about 2 s on Linux):

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { pollUntil, probe, startServer } from "./effects.js";
import { isAlive } from "./lock.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

describe("the launcher's start", () => {
  it("starts a real server that answers with its process, and stops it on request", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tj-launch-"));
    const port = await freePort();
    const pid = startServer({ repo: REPO, dataDir, port, node: process.execPath });
    try {
      const up = await pollUntil(async () => {
        const found = await probe(port);
        return found.kind === "journal" && found.pid === pid;
      }, 30_000);
      expect(up).toBe(true);
      const res = await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(await pollUntil(async () => (await probe(port)).kind === "down", 10_000)).toBe(true);
      await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 5000 });
    } finally {
      if (isAlive(pid)) process.kill(pid);
      // After the process is gone: Windows won't delete a folder a running process holds.
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});
```

- [ ] **Step 2: Run them; they fail:** `pnpm --filter @tj/server exec vitest run src/launch`.
- [ ] **Step 3: Implement.**

`args.ts`:

```ts
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
```

`effects.ts`:

```ts
import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ClickEffects, LaunchState, Probe, UpdateResult } from "./click.js";
import { isAlive } from "./lock.js";

export interface LaunchPaths {
  repo: string;
  dataDir: string;
  port: number;
  node: string;
  pnpm: string;
}

export const journalUrl = (port: number) => `http://127.0.0.1:${port}/`;
export const logFile = (dataDir: string) => join(dataDir, "logs", "server.log");
const stateFile = (dataDir: string) => join(dataDir, "launcher.json");

/**
 * What answers on the port (launcher spec §3.2). A journal from before this change answers a bare `{ ok: true }`;
 * a port that holds the connection without answering is another program.
 */
export async function probe(port: number, timeoutMs = 1000): Promise<Probe> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json().catch(() => null)) as { ok?: unknown; app?: unknown; pid?: unknown } | null;
    if (body?.app === "trading-journal" || (body?.ok === true && body.app === undefined)) {
      return { kind: "journal", pid: typeof body.pid === "number" ? body.pid : null };
    }
    return { kind: "other" };
  } catch (error) {
    return (error as Error).name === "TimeoutError" ? { kind: "other" } : { kind: "down" };
  }
}

export async function pollUntil(
  check: () => Promise<boolean>,
  timeoutMs: number,
  giveUp: () => boolean = () => false,
  everyMs = 200,
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    if (giveUp()) return false;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  return check();
}

/** Runs a command, keeping its output for the error page. A Windows `.cmd` needs a shell. */
function run(command: string, args: string[], cwd: string): Promise<UpdateResult> {
  return new Promise((resolve) => {
    const shell = /\.(cmd|bat)$/i.test(command);
    const child = spawn(shell ? `"${command}"` : command, args, { cwd, shell, windowsHide: true });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", (error) => resolve({ ok: false, output: `${output}${error.message}\n` }));
    child.on("close", (code) => resolve({ ok: code === 0, output }));
  });
}

/**
 * Starts the server in the background (launcher spec §3.2): one node process with tsx loaded, so its pid is the
 * server's own; no window; output to logs/server.log, the last run's kept as server.1.log.
 */
export function startServer(
  paths: Pick<LaunchPaths, "repo" | "dataDir" | "port" | "node">,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const log = logFile(paths.dataDir);
  mkdirSync(dirname(log), { recursive: true });
  if (existsSync(log)) renameSync(log, join(dirname(log), "server.1.log"));
  const fd = openSync(log, "a");
  const child = spawn(paths.node, ["--import", "tsx", "src/index.ts"], {
    cwd: join(paths.repo, "apps", "server"),
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    env: { ...env, TJ_DATA_DIR: paths.dataDir, TJ_PORT: String(paths.port) },
  });
  child.unref();
  closeSync(fd);
  if (child.pid == null) throw new Error("The server process didn't start");
  return child.pid;
}

export function browserCommand(url: string, platform: NodeJS.Platform) {
  if (platform === "win32") return { command: "cmd", args: ["/c", `start "" "${url}"`], verbatim: true };
  return { command: platform === "darwin" ? "open" : "xdg-open", args: [url], verbatim: false };
}

/** Opens a URL in the default browser, Firefox included. */
export function openInBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const { command, args, verbatim } = browserCommand(url, platform);
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: verbatim }).unref();
}

export function realEffects(paths: LaunchPaths): ClickEffects {
  return {
    probe: () => probe(paths.port),
    head: () =>
      new Promise((resolve) =>
        execFile("git", ["rev-parse", "HEAD"], { cwd: paths.repo, windowsHide: true }, (error, out) =>
          resolve(error ? null : out.trim() || null),
        ),
      ),
    readState: () => {
      try {
        return JSON.parse(readFileSync(stateFile(paths.dataDir), "utf8")) as LaunchState;
      } catch {
        return null;
      }
    },
    writeState: (state) => writeFileSync(stateFile(paths.dataDir), JSON.stringify(state)),
    stop: async () => {
      await fetch(`http://127.0.0.1:${paths.port}/api/shutdown`, {
        method: "POST",
        signal: AbortSignal.timeout(1000),
      }).catch(() => undefined);
      return pollUntil(async () => (await probe(paths.port)).kind === "down", 10_000);
    },
    update: async () => {
      const install = await run(paths.pnpm, ["install", "--frozen-lockfile"], paths.repo);
      if (!install.ok) return install;
      const build = await run(paths.pnpm, ["build"], paths.repo);
      return { ok: build.ok, output: install.output + build.output };
    },
    start: () => startServer(paths),
    waitUp: (pid) =>
      pollUntil(
        async () => {
          const found = await probe(paths.port);
          return found.kind === "journal" && found.pid === pid;
        },
        30_000,
        () => !isAlive(pid),
      ),
    openBrowser: () => openInBrowser(journalUrl(paths.port)),
    now: () => Date.now(),
  };
}
```

`run.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveDataDir } from "../config.js";
import { parseLaunchArgs } from "./args.js";
import { click } from "./click.js";
import { type LaunchPaths, logFile, openInBrowser, realEffects } from "./effects.js";
import { errorPage, type Failure, failureReason } from "./errorPage.js";
import { releaseLock, takeLock } from "./lock.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export interface RunDeps {
  click: typeof click;
  effects: (paths: LaunchPaths) => ReturnType<typeof realEffects>;
  open: (url: string) => void;
  exists: (path: string) => boolean;
  now: () => number;
}

/** One click on the icon, from its arguments to an exit code (launcher spec §3.2, §3.5). */
export async function runLaunch(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  overrides: Partial<RunDeps> = {},
): Promise<number> {
  const deps: RunDeps = {
    click,
    effects: realEffects,
    open: (url) => openInBrowser(url),
    exists: existsSync,
    now: Date.now,
    ...overrides,
  };
  const args = parseLaunchArgs(argv);
  const dataDir = args.dataDir ?? resolveDataDir(env, process.platform, homedir());
  const port = args.port ?? 4178;
  mkdirSync(join(dataDir, "logs"), { recursive: true });

  const fail = (failure: Failure) => {
    const page = join(dataDir, "launch-error.html");
    const log = existsSync(logFile(dataDir)) ? readFileSync(logFile(dataDir), "utf8") : "";
    writeFileSync(page, errorPage(failure, log));
    console.error(failureReason(failure));
    deps.open(pathToFileURL(page).href);
    return 1;
  };

  if (!deps.exists(args.pnpm)) return fail({ kind: "tool-missing", path: args.pnpm });
  const lock = join(dataDir, "launch.lock");
  // Another click is starting the journal, and opens the browser itself.
  if (!takeLock(lock, deps.now())) return 0;
  try {
    const paths: LaunchPaths = { repo: REPO, dataDir, port, node: process.execPath, pnpm: args.pnpm };
    const outcome = await deps.click(deps.effects(paths), port);
    return outcome.kind === "failed" ? fail(outcome.failure) : 0;
  } finally {
    releaseLock(lock);
  }
}
```

`main.ts`:

```ts
import { runLaunch } from "./run.js";

/** What the Trading Journal icon runs (launcher spec §3.2). */
process.exitCode = await runLaunch(process.argv.slice(2), process.env).catch((error: unknown) => {
  console.error(error);
  return 1;
});
```

- [ ] **Step 4: Run the tests; they pass.** The end-to-end test needs `apps/server/node_modules/tsx`, which `pnpm install` already provides.
- [ ] **Step 5: Try it by hand.**
  - Run `node --import tsx src/launch/main.ts --pnpm "$(command -v pnpm)" --data-dir <scratch dir> --port 4391` from `apps/server`. The browser opens on the journal, empty because the scratch directory is new.
  - Run it again: the browser opens, and nothing new starts.
  - Stop the server: `curl -X POST http://127.0.0.1:4391/api/shutdown`.
- [ ] **Step 6: Commit:** `feat(server): the launcher's click, start and browser, with an end-to-end start and stop`.

### Task 7: the icon, `pnpm launcher:install` / `launcher:remove`, and the favicon

**Files:**
- Create: `scripts/make-icons.mjs`, `apps/web/public/icon.svg`, `icon-256.png` and `icon.ico` (made by the script), `apps/server/src/launch/install.ts`, `install.test.ts` and `setup.ts`
- Modify: `apps/server/package.json` (script `"launcher": "tsx src/launch/setup.ts"`), root `package.json` (scripts `"launcher:install": "pnpm --filter @tj/server launcher install"`, `"launcher:remove": "pnpm --filter @tj/server launcher remove"`), `apps/web/index.html` (favicon)

**Interfaces:**
- Consumes: `launchArgs` (Task 6).
- Produces:

```ts
export interface LauncherSetup { node: string; pnpm: string; repo: string; dataDir: string | null; port: number | null }
export function execArg(arg: string): string;
export function desktopEntry(setup: LauncherSetup): string;
export function winArg(arg: string): string;
export function shortcutScript(setup: LauncherSetup, lnk: string): string;
export function launcherFile(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string | null;
export function findOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists?: (path: string) => boolean): string | null;
export function installLauncher(setup: LauncherSetup, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string;
export function removeLauncher(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string | null;
```

- [ ] **Step 1: Make the icons.**

`scripts/make-icons.mjs`:

```js
// Draws the journal's icon (launcher spec §3.6): the nav's blue square with a white candle. No dependencies:
// shapes on a 256 grid, 4×4 samples a pixel for smooth corners, PNG through zlib, and an ICO of PNGs.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public");
const BLUE = [0x29, 0x62, 0xff];
const WHITE = [0xff, 0xff, 0xff];
// [x, y, width, height, corner radius] on a 256 grid.
const SQUARE = [0, 0, 256, 256, 40];
const WICK = [122, 40, 12, 176, 0];
const BODY = [92, 84, 72, 92, 6];

function inside(px, py, [x, y, w, h, r]) {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function colorAt(gx, gy) {
  if (inside(gx, gy, WICK) || inside(gx, gy, BODY)) return WHITE;
  return inside(gx, gy, SQUARE) ? BLUE : null;
}

function pixels(size) {
  const data = Buffer.alloc(size * size * 4);
  const scale = 256 / size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sum = [0, 0, 0];
      let hits = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          const color = colorAt((x + (sx + 0.5) / 4) * scale, (y + (sy + 0.5) / 4) * scale);
          if (!color) continue;
          hits += 1;
          for (let c = 0; c < 3; c += 1) sum[c] += color[c];
        }
      }
      const at = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) data[at + c] = hits ? Math.round(sum[c] / hits) : 0;
      data[at + 3] = Math.round((hits / 16) * 255);
    }
  }
  return data;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(size) {
  const rgba = pixels(size);
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function ico(sizes) {
  const images = sizes.map(png);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((size, i) => {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(images[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images]);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="40" fill="#2962ff"/><rect x="122" y="40" width="12" height="176" fill="#fff"/><rect x="92" y="84" width="72" height="92" rx="6" fill="#fff"/></svg>\n`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon.svg"), SVG);
writeFileSync(join(OUT, "icon-256.png"), png(256));
writeFileSync(join(OUT, "icon.ico"), ico([16, 32, 48, 256]));
console.log(`Icons written to ${OUT}`);
```

Run `node scripts/make-icons.mjs`. Open `apps/web/public/icon-256.png` with the Read tool and check it: a blue rounded square with a white candle, with smooth corners.

In `apps/web/index.html`, after the viewport meta, add `<link rel="icon" type="image/svg+xml" href="/icon.svg" />`.

- [ ] **Step 2: Write the setup tests** (`install.test.ts`):

```ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  desktopEntry,
  execArg,
  findOnPath,
  installLauncher,
  type LauncherSetup,
  launcherFile,
  removeLauncher,
  shortcutScript,
  winArg,
} from "./install.js";

const LINUX: LauncherSetup = {
  node: "/usr/bin/node",
  pnpm: "/home/u/.local/bin/pnpm",
  repo: "/home/u/Projects/TradingJournal",
  dataDir: null,
  port: null,
};
const WINDOWS: LauncherSetup = {
  node: "C:\\Program Files\\nodejs\\node.exe",
  pnpm: "C:\\Users\\G Z\\AppData\\Local\\pnpm\\pnpm.exe",
  repo: "C:\\Users\\G Z\\Projects\\TradingJournal",
  dataDir: null,
  port: 4300,
};

describe("the Fedora entry", () => {
  it("runs the launcher from apps/server with the recorded node and pnpm", () => {
    expect(desktopEntry(LINUX)).toBe(
      [
        "[Desktop Entry]",
        "Type=Application",
        "Name=Trading Journal",
        "Comment=Open your trading journal",
        'Exec="/usr/bin/node" "--import" "tsx" "src/launch/main.ts" "--pnpm" "/home/u/.local/bin/pnpm"',
        "Path=/home/u/Projects/TradingJournal/apps/server",
        "Icon=/home/u/Projects/TradingJournal/apps/web/public/icon-256.png",
        "Terminal=false",
        "Categories=Office;Finance;",
        "StartupNotify=false",
        "",
      ].join("\n"),
    );
  });

  it("escapes what the desktop entry spec asks", () => {
    expect(execArg('/a "b"$c%')).toBe(String.raw`"/a \\"b\\"\\$c%%"`);
    expect(execArg("/a\\b")).toBe(String.raw`"/a\\\\b"`);
  });
});

describe("the Windows shortcut", () => {
  it("is made by PowerShell, minimized, with the icon", () => {
    const script = shortcutScript(WINDOWS, "C:\\Users\\G Z\\Start Menu\\Trading Journal.lnk");
    expect(script).toContain(
      "CreateShortcut('C:\\Users\\G Z\\Start Menu\\Trading Journal.lnk')",
    );
    expect(script).toContain("$s.TargetPath = 'C:\\Program Files\\nodejs\\node.exe'");
    expect(script).toContain(
      `$s.Arguments = '--import tsx src/launch/main.ts --pnpm "C:\\Users\\G Z\\AppData\\Local\\pnpm\\pnpm.exe" --port 4300'`,
    );
    expect(script).toContain("$s.WorkingDirectory = 'C:\\Users\\G Z\\Projects\\TradingJournal\\apps\\server'");
    expect(script).toContain("$s.IconLocation = 'C:\\Users\\G Z\\Projects\\TradingJournal\\apps\\web\\public\\icon.ico'");
    expect(script).toContain("$s.WindowStyle = 7");
  });

  it("quotes arguments and PowerShell strings safely", () => {
    expect(winArg("plain")).toBe("plain");
    expect(winArg("has space")).toBe('"has space"');
    expect(winArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(shortcutScript({ ...WINDOWS, node: "C:\\O'Neil\\node.exe" }, "x.lnk")).toContain("'C:\\O''Neil\\node.exe'");
  });
});

describe("where it goes", () => {
  it("is the app menu on Fedora and the Start menu on Windows", () => {
    expect(launcherFile("linux", {}, "/home/u")).toBe("/home/u/.local/share/applications/trading-journal.desktop");
    expect(launcherFile("linux", { XDG_DATA_HOME: "/x" }, "/home/u")).toBe("/x/applications/trading-journal.desktop");
    expect(launcherFile("win32", { APPDATA: "C:\\Users\\G\\AppData\\Roaming" }, "C:\\Users\\G")).toBe(
      "C:\\Users\\G\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Trading Journal.lnk",
    );
    expect(launcherFile("darwin", {}, "/Users/g")).toBeNull();
  });

  it("finds pnpm on the PATH", () => {
    const have = new Set(["/b/pnpm", "C:\\pn\\pnpm.cmd"]);
    expect(findOnPath("pnpm", { PATH: "/a:/b" }, "linux", (path) => have.has(path))).toBe("/b/pnpm");
    expect(
      findOnPath("pnpm", { PATH: "C:\\x;C:\\pn", PATHEXT: ".EXE;.CMD" }, "win32", (path) => have.has(path)),
    ).toBe("C:\\pn\\pnpm.cmd");
    expect(findOnPath("pnpm", { PATH: "/a" }, "linux", () => false)).toBeNull();
  });
});

describe.runIf(process.platform === "linux")("on Linux, for real", () => {
  it("writes and removes the entry", () => {
    const env = { XDG_DATA_HOME: mkdtempSync(join(tmpdir(), "tj-xdg-")) };
    const file = installLauncher(LINUX, "linux", env, "/home/u");
    expect(readFileSync(file, "utf8")).toBe(desktopEntry(LINUX));
    expect(removeLauncher("linux", env, "/home/u")).toBe(file);
    expect(existsSync(file)).toBe(false);
  });
});

describe.runIf(process.platform === "win32")("on Windows, for real", () => {
  it("makes a shortcut PowerShell can read back, and removes it", () => {
    const env = { APPDATA: mkdtempSync(join(tmpdir(), "tj-appdata-")) };
    const setup = { ...WINDOWS, node: process.execPath };
    const file = installLauncher(setup, "win32", env, "C:\\Users\\G");
    const read = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `(New-Object -ComObject WScript.Shell).CreateShortcut('${file}').TargetPath`],
      { encoding: "utf8" },
    );
    expect(read.stdout.trim()).toBe(process.execPath);
    expect(removeLauncher("win32", env, "C:\\Users\\G")).toBe(file);
    expect(existsSync(file)).toBe(false);
  });
});
```

- [ ] **Step 3: Run them; they fail:** `pnpm --filter @tj/server exec vitest run src/launch/install.test.ts`.
- [ ] **Step 4: Implement `install.ts`:**

```ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { launchArgs } from "./args.js";

/** What `pnpm launcher:install` records (launcher spec §3.1). */
export interface LauncherSetup {
  node: string;
  pnpm: string;
  repo: string;
  dataDir: string | null;
  port: number | null;
}

/**
 * One Exec argument, as the desktop entry spec asks: quoted, `"` `` ` `` `$` `\` escaped, then the string
 * escaping doubles each backslash, and `%` is written `%%`.
 */
export const execArg = (arg: string) =>
  `"${arg.replace(/[\\"`$]/g, (char) => (char === "\\" ? "\\\\\\\\" : `\\\\${char}`)).replace(/%/g, "%%")}"`;

/** The Fedora app-menu entry: `trading-journal.desktop`. */
export function desktopEntry(setup: LauncherSetup): string {
  const exec = [setup.node, ...launchArgs(setup)].map(execArg).join(" ");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Trading Journal",
    "Comment=Open your trading journal",
    `Exec=${exec}`,
    `Path=${posix.join(setup.repo, "apps", "server")}`,
    `Icon=${posix.join(setup.repo, "apps", "web", "public", "icon-256.png")}`,
    "Terminal=false",
    "Categories=Office;Finance;",
    "StartupNotify=false",
    "",
  ].join("\n");
}

/** A Windows command-line argument: quoted when it holds a space or a quote. */
export const winArg = (arg: string) =>
  /[\s"]/.test(arg) ? `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"` : arg;
const psString = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** The PowerShell that makes the Start-menu shortcut: minimized, so its console only flashes on the taskbar. */
export function shortcutScript(setup: LauncherSetup, lnk: string): string {
  return [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psString(lnk)})`,
    `$s.TargetPath = ${psString(setup.node)}`,
    `$s.Arguments = ${psString(launchArgs(setup).map(winArg).join(" "))}`,
    `$s.WorkingDirectory = ${psString(win32.join(setup.repo, "apps", "server"))}`,
    `$s.IconLocation = ${psString(win32.join(setup.repo, "apps", "web", "public", "icon.ico"))}`,
    "$s.WindowStyle = 7",
    "$s.Description = 'Open your trading journal'",
    "$s.Save()",
  ].join("\n");
}

export function launcherFile(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string | null {
  if (platform === "win32") {
    const roaming = env.APPDATA ?? win32.join(home, "AppData", "Roaming");
    return win32.join(roaming, "Microsoft", "Windows", "Start Menu", "Programs", "Trading Journal.lnk");
  }
  if (platform === "linux") {
    const data = env.XDG_DATA_HOME ?? posix.join(home, ".local", "share");
    return posix.join(data, "applications", "trading-journal.desktop");
  }
  return null;
}

/** A command's full path, as the terminal's PATH finds it. */
export function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const windows = platform === "win32";
  const dirs = (env.PATH ?? env.Path ?? "").split(windows ? ";" : ":").filter(Boolean);
  const extensions = windows ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = (windows ? win32 : posix).join(dir, `${name}${extension.toLowerCase()}`);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

const MAC = "The launcher icon is for Linux and Windows; on a Mac, run `pnpm start`.";

/** Writes the icon; returns where. */
export function installLauncher(
  setup: LauncherSetup,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string {
  const file = launcherFile(platform, env, home);
  if (!file) throw new Error(MAC);
  mkdirSync((platform === "win32" ? win32 : posix).dirname(file), { recursive: true });
  if (platform === "win32") {
    const made = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", shortcutScript(setup, file)],
      { encoding: "utf8", windowsHide: true },
    );
    if (made.status !== 0) throw new Error(`PowerShell couldn't make the shortcut: ${made.stderr.trim()}`);
  } else {
    writeFileSync(file, desktopEntry(setup), { mode: 0o755 });
    // Optional: menus pick the entry up anyway, this only makes it quicker.
    spawnSync("update-desktop-database", [posix.dirname(file)], { stdio: "ignore" });
  }
  return file;
}

/** Deletes the icon; returns where it was, or null when there was none. */
export function removeLauncher(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string | null {
  const file = launcherFile(platform, env, home);
  if (!file || !existsSync(file)) return null;
  rmSync(file);
  return file;
}
```

`setup.ts`:

```ts
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findOnPath, installLauncher, removeLauncher } from "./install.js";

/** `pnpm launcher:install` and `pnpm launcher:remove` (launcher spec §3.1). */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const command = process.argv[2];

try {
  if (command === "install") {
    const pnpm = findOnPath("pnpm", process.env, process.platform);
    if (!pnpm) throw new Error("pnpm isn't on your PATH. Install pnpm, then run this again.");
    const port = process.env.TJ_PORT ? Number(process.env.TJ_PORT) : null;
    const file = installLauncher(
      { node: process.execPath, pnpm, repo: REPO, dataDir: process.env.TJ_DATA_DIR ?? null, port },
      process.platform,
      process.env,
      homedir(),
    );
    const where = process.platform === "win32" ? "the Start menu (pin it to the taskbar)" : "your apps (pin it to the dock)";
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
```

Add the package scripts listed under **Files**.

- [ ] **Step 5: Run the tests; they pass.** Then try it for real on this machine, with no `TJ_*` variables set:
  1. `pnpm launcher:install`.
  2. Read `~/.local/share/applications/trading-journal.desktop` and check its `Exec` paths exist.
  3. Leave it installed; the live check (Task 14) clicks it.
- [ ] **Step 6: Commit:** `feat: the Trading Journal icon, pnpm launcher:install and launcher:remove, and the favicon`.

### Task 8: Settings — Stop the journal, and the stopped screen

**Files:**
- Create: `apps/web/src/stopped.ts`, `apps/web/src/routes/JournalPanel.tsx`, `apps/web/src/routes/JournalPanel.test.tsx`, `apps/web/src/components/Stopped.tsx`
- Modify: `apps/web/src/routes/Settings.tsx` (render `<JournalPanel />` last), `apps/web/src/router.tsx` (`RootLayout`)

**Interfaces:**
- Consumes: `POST /api/shutdown` (Task 4).
- Produces: `markStopped(): void`, `useStopped(): boolean`, `resetStopped(): void` (for tests), `<JournalPanel />`, `<Stopped />`.

- [ ] **Step 1: Write the test** (`JournalPanel.test.tsx`):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Stopped } from "../components/Stopped.js";
import { resetStopped, useStopped } from "../stopped.js";
import { JournalPanel } from "./JournalPanel.js";

function Probe() {
  return <span data-testid="stopped">{String(useStopped())}</span>;
}

function renderPanel(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <JournalPanel />
      <Probe />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetStopped();
});

describe("Stop the journal", () => {
  it("asks the server to stop, then the app says it has stopped", async () => {
    const fetchMock = renderPanel(200, { ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Stop the journal" }));
    await waitFor(() => expect(screen.getByTestId("stopped").textContent).toBe("true"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/api/shutdown");
    expect(init.method).toBe("POST");
  });

  it("says so when this server can't be stopped", async () => {
    renderPanel(404, { error: "not found" });
    fireEvent.click(screen.getByRole("button", { name: "Stop the journal" }));
    expect(await screen.findByText("stop failed: 404")).toBeTruthy();
    expect(screen.getByTestId("stopped").textContent).toBe("false");
  });

  it("the stopped screen says how to start it again", () => {
    render(<Stopped />);
    expect(screen.getByRole("main").textContent).toBe(
      "The journal has stopped. Open it again from its icon, or run pnpm start.",
    );
  });
});
```

- [ ] **Step 2: Run it; it fails:** `pnpm --filter @tj/web exec vitest run src/routes/JournalPanel.test.tsx`.
- [ ] **Step 3: Implement.**

`stopped.ts`:

```ts
import { useSyncExternalStore } from "react";

/** Whether Stop the journal has stopped the server (launcher spec §3.4): the app then shows only that. */
let stopped = false;
const listeners = new Set<() => void>();

export function markStopped(): void {
  stopped = true;
  for (const listener of listeners) listener();
}

export function useStopped(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => stopped,
  );
}

/** Tests only. */
export function resetStopped(): void {
  stopped = false;
}
```

`components/Stopped.tsx`:

```tsx
/** In place of the whole app once the server has stopped (launcher spec §3.4). */
export function Stopped() {
  return (
    <main className="flex h-full items-center justify-center p-8 text-center text-muted">
      <p>
        The journal has stopped. Open it again from its icon, or run <code className="num text-fg">pnpm start</code>.
      </p>
    </main>
  );
}
```

`routes/JournalPanel.tsx`:

```tsx
import { useMutation } from "@tanstack/react-query";
import { api, refusal } from "../api.js";
import { Panel } from "../components/ui.js";
import { markStopped } from "../stopped.js";

/** Settings' Journal panel (launcher spec §3.4): stop the server the icon started. No confirm: the icon starts it again. */
export function JournalPanel() {
  const stop = useMutation({
    mutationFn: async () => {
      const res = await api.api.shutdown.$post();
      if (!res.ok) throw await refusal(res, "stop");
    },
    onSuccess: markStopped,
  });
  return (
    <Panel title="Journal">
      <p className="text-[11px] text-muted">
        Opened from its icon, the journal keeps running in the background until you log out. Stop it here; the
        icon starts it again in a few seconds.
      </p>
      <button
        type="button"
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        className="mt-2 rounded-sm border border-line px-3 py-1 text-fg hover:border-down disabled:opacity-50"
      >
        Stop the journal
      </button>
      {stop.error && <p className="mt-2 text-down">{stop.error.message}</p>}
    </Panel>
  );
}
```

In `router.tsx`:
- rename the current `RootLayout` body into `function Running()`;
- make `RootLayout` return `useStopped() ? <Stopped /> : <Running />`.

The sync, queue and badge hooks then unmount with the shell, so a stopped app makes no requests.

- [ ] **Step 4: Run the test; it passes.** Then run `pnpm --filter @tj/web exec vitest run src/routes/Settings.test.tsx`, since Settings renders a new panel.
- [ ] **Step 5: Commit:** `feat(web): Stop the journal in Settings, and the stopped screen`.

---

## Part C — The keyboard (spec §4–6)

### Task 9: the shortcut layer and the ? help

**Files:**
- Create: `apps/web/src/keys/keyName.ts`, `keyName.test.ts`, `Shortcuts.tsx`, `Shortcuts.test.tsx`
- Modify: `apps/web/src/router.tsx` (`Running` wraps the shell in `<ShortcutsProvider>`), `apps/web/src/screenshots/Lightbox.tsx` (first line of the component: `useModalLayer(true);`; the lightbox is only mounted while open)

**Interfaces (produces):**
```ts
export function keyName(event: Pick<KeyboardEvent, "key" | "code">): string | null; // "j", "1", "?", "Enter", "Escape"
export function ShortcutsProvider({ children }: { children: ReactNode }): JSX.Element;
/** Registers `key` while mounted; null registers nothing. The latest registration of a key wins. */
export function useShortcut(key: string | null, label: string, group: string, run: () => void): void;
/** While `active`, page keys are off: palette, help, lightbox. */
export function useModalLayer(active: boolean): void;
```
Without a provider (most component tests), `useShortcut` and `useModalLayer` do nothing.

- [ ] **Step 1: Write the tests.**

`keyName.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { keyName } from "./keyName.js";

describe("keyName", () => {
  it.each([
    [{ key: "j", code: "KeyJ" }, "j"],
    [{ key: "J", code: "KeyJ" }, "j"],
    [{ key: "ξ", code: "KeyJ" }, "j"],
    [{ key: "1", code: "Digit1" }, "1"],
    [{ key: "1", code: "Numpad1" }, "1"],
    [{ key: "?", code: "Slash" }, "?"],
    [{ key: "Enter", code: "Enter" }, "Enter"],
    [{ key: "Escape", code: "Escape" }, "Escape"],
    [{ key: "!", code: "Digit1" }, null],
    [{ key: "ArrowDown", code: "ArrowDown" }, null],
  ])("%o → %s", (event, name) => {
    expect(keyName(event)).toBe(name);
  });
});
```

`Shortcuts.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ShortcutsProvider, useModalLayer, useShortcut } from "./Shortcuts.js";

function Page({ run, modal = false }: { run: (key: string) => void; modal?: boolean }) {
  useShortcut("j", "Next trade", "Review", () => run("j"));
  useShortcut("Enter", "Done, then next", "Review", () => run("Enter"));
  return (
    <div>
      <textarea aria-label="Notes" data-key-target="notes" />
      <input aria-label="Search" />
      <button type="button">B</button>
      {modal && <Modal />}
    </div>
  );
}
function Modal() {
  useModalLayer(true);
  return null;
}
function Later({ run }: { run: (key: string) => void }) {
  useShortcut("j", "Later J", "Review", () => run("later"));
  return null;
}

const press = (key: string, init: Partial<KeyboardEventInit> = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ...init });

describe("the shortcut layer", () => {
  it("runs a registered key, also from another layout", () => {
    const run = vi.fn();
    render(<ShortcutsProvider><Page run={run} /></ShortcutsProvider>);
    press("j");
    fireEvent.keyDown(document.body, { key: "ξ", code: "KeyJ" });
    expect(run.mock.calls).toEqual([["j"], ["j"]]);
  });

  it("leaves typing alone, and Esc in a review field gives the keys back", () => {
    const run = vi.fn();
    render(<ShortcutsProvider><Page run={run} /></ShortcutsProvider>);
    const notes = screen.getByRole("textbox", { name: "Notes" });
    notes.focus();
    press("j", {}, notes);
    press("j", {}, screen.getByRole("textbox", { name: "Search" }));
    expect(run).not.toHaveBeenCalled();
    press("Escape", {}, notes);
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves modifier keys and handled keys alone", () => {
    const run = vi.fn();
    render(<ShortcutsProvider><Page run={run} /></ShortcutsProvider>);
    press("j", { ctrlKey: true });
    press("j", { altKey: true });
    const handled = new KeyboardEvent("keydown", { key: "j", code: "KeyJ", bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(run).not.toHaveBeenCalled();
  });

  it("is off while a modal layer is up", () => {
    const run = vi.fn();
    const { rerender } = render(<ShortcutsProvider><Page run={run} modal /></ShortcutsProvider>);
    press("j");
    expect(run).not.toHaveBeenCalled();
    rerender(<ShortcutsProvider><Page run={run} /></ShortcutsProvider>);
    press("j");
    expect(run).toHaveBeenCalledOnce();
  });

  it("takes Enter from a button the mouse focused, not from one reached by Tab", () => {
    const run = vi.fn();
    render(<ShortcutsProvider><Page run={run} /></ShortcutsProvider>);
    const button = screen.getByRole("button", { name: "B" });
    fireEvent.pointerDown(button);
    button.focus();
    press("Enter", {}, button);
    expect(run).toHaveBeenCalledWith("Enter");
    run.mockClear();
    button.blur();
    press("Tab");
    button.focus();
    press("Enter", {}, button);
    expect(run).not.toHaveBeenCalled();
  });

  it("lets the latest registration win, and forgets one that unmounts", () => {
    const run = vi.fn();
    function Both() {
      const [later, setLater] = useState(true);
      return (
        <>
          <Page run={run} />
          {later && <Later run={run} />}
          <button type="button" onClick={() => setLater(false)}>
            drop
          </button>
        </>
      );
    }
    render(<ShortcutsProvider><Both /></ShortcutsProvider>);
    press("j");
    fireEvent.click(screen.getByRole("button", { name: "drop" }));
    press("j");
    expect(run.mock.calls).toEqual([["later"], ["j"]]);
  });

  it("? shows every key by group, and page keys stay off until it closes", () => {
    const run = vi.fn();
    render(<ShortcutsProvider><Page run={run} /></ShortcutsProvider>);
    fireEvent.keyDown(document.body, { key: "?", code: "Slash" });
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(help.textContent).toContain("Next trade");
    expect(help.textContent).toContain("Search pages and trades");
    expect(help.textContent).toContain("Review");
    press("j");
    expect(run).not.toHaveBeenCalled();
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    press("j");
    expect(run).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run them; they fail:** `pnpm --filter @tj/web exec vitest run src/keys`.
- [ ] **Step 3: Implement.**

`keyName.ts`:

```ts
/**
 * The name a shortcut is registered under (launcher-keys-palette spec §4): a Latin letter in lower case, a digit,
 * "?", Enter or Escape. On another layout, such as Greek, J types "ξ"; then the physical key names it.
 */
export function keyName(event: Pick<KeyboardEvent, "key" | "code">): string | null {
  const { key, code } = event;
  if (key === "Enter" || key === "Escape" || key === "?") return key;
  if (/^[a-z0-9]$/i.test(key)) return key.toLowerCase();
  if (/^\p{L}$/u.test(key)) return /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase() ?? null;
  return null;
}
```

`Shortcuts.tsx`:

```tsx
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { keyName } from "./keyName.js";

/** A registered key, as the help lists it. */
export interface ShortcutInfo {
  key: string;
  label: string;
  group: string;
}
interface Entry extends ShortcutInfo {
  run: () => void;
}

/** The keys pages have registered, and how many modal layers are up (spec §4). */
class Registry {
  private entries: Entry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: readonly ShortcutInfo[] = [];
  layers = 0;

  add(entry: Entry): () => void {
    this.entries.push(entry);
    this.changed();
    return () => {
      this.entries = this.entries.filter((each) => each !== entry);
      this.changed();
    };
  }

  /** The latest registration of a key. */
  find(key: string): Entry | undefined {
    return this.entries.findLast((each) => each.key === key);
  }

  list = (): readonly ShortcutInfo[] => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private changed() {
    // One line a key: the one that runs.
    const seen = new Set<string>();
    this.snapshot = [...this.entries]
      .reverse()
      .filter((each) => !seen.has(each.key) && seen.add(each.key))
      .reverse()
      .map(({ key, label, group }) => ({ key, label, group }));
    for (const listener of this.listeners) listener();
  }
}

const RegistryContext = createContext<Registry | null>(null);

const TYPING =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable=""], [contenteditable="true"]';
const ACTIVATES = 'button, a[href], [role="button"], summary';

export function useShortcut(key: string | null, label: string, group: string, run: () => void): void {
  const registry = useContext(RegistryContext);
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!registry || key == null) return;
    return registry.add({ key, label, group, run: () => latest.current() });
  }, [registry, key, label, group]);
}

export function useModalLayer(active: boolean): void {
  const registry = useContext(RegistryContext);
  useEffect(() => {
    if (!registry || !active) return;
    registry.layers += 1;
    return () => {
      registry.layers -= 1;
    };
  }, [registry, active]);
}

const KEY_TEXT: Record<string, string> = { Enter: "Enter", Escape: "Esc", "?": "?" };

function Help({ registry, onClose }: { registry: Registry; onClose: () => void }) {
  const list = useSyncExternalStore(registry.subscribe, registry.list);
  useModalLayer(true);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "?") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onClose]);
  const groups = new Map<string, ShortcutInfo[]>([["General", []]]);
  for (const each of list) groups.set(each.group, [...(groups.get(each.group) ?? []), each]);
  const row = (key: string, label: string) => (
    <div key={key} className="flex gap-3 py-0.5">
      <dt className="w-14 shrink-0">
        <kbd className="num rounded-[2px] border border-line px-1 text-fg">{key}</kbd>
      </dt>
      <dd className="text-muted">{label}</dd>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative w-96 rounded-sm border border-line bg-panel p-4 text-[12px]"
      >
        <h2 className="mb-2 font-semibold text-fg">Keyboard shortcuts</h2>
        {[...groups].map(([group, items]) => (
          <section key={group} className="mb-2">
            <h3 className="text-[10px] text-muted uppercase tracking-wider">{group}</h3>
            <dl>
              {group === "General" && row("Ctrl K", "Search pages and trades")}
              {items.map((each) => row(KEY_TEXT[each.key] ?? each.key.toUpperCase(), each.label))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

/** The app's one key listener (spec §4): pages register keys; fields, modifiers and modal layers keep them off. */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => new Registry(), []);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    // Enter belongs to the layer on a button the mouse focused, so a click then Enter doesn't click it again.
    let lastInput: "pointer" | "key" = "key";
    let pointerFocus = false;
    const onPointer = () => {
      lastInput = "pointer";
    };
    const onFocus = () => {
      pointerFocus = lastInput === "pointer";
    };
    const onKey = (event: KeyboardEvent) => {
      lastInput = "key";
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const name = keyName(event);
      if (!name) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.matches(TYPING)) {
        // Esc gives a review field's focus back to the page, so the keys work again (spec §6.3).
        if (name === "Escape" && target instanceof HTMLElement && target.closest("[data-key-target]")) target.blur();
        return;
      }
      if (registry.layers > 0) return;
      if (name === "Enter" && target?.matches(ACTIVATES) && !pointerFocus) return;
      const entry = registry.find(name);
      if (!entry) return;
      event.preventDefault();
      entry.run();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("focus", onFocus, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("focus", onFocus, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [registry]);

  return (
    <RegistryContext.Provider value={registry}>
      <HelpKey onOpen={() => setHelp(true)} />
      {children}
      {help && <Help registry={registry} onClose={() => setHelp(false)} />}
    </RegistryContext.Provider>
  );
}

function HelpKey({ onOpen }: { onOpen: () => void }) {
  useShortcut("?", "Show shortcuts", "General", onOpen);
  return null;
}
```

`Array.prototype.findLast` needs `lib` ES2023. If `pnpm typecheck` rejects it, loop from the end instead:

```ts
for (let i = this.entries.length - 1; i >= 0; i -= 1) if (this.entries[i]?.key === key) return this.entries[i];
```

In `router.tsx`, rename the root layout's body to `Running`, as in Task 8, and wrap the `<Shell>` in `<ShortcutsProvider>`. In `Lightbox.tsx`, add `useModalLayer(true);` as the component's first hook, importing it from `../keys/Shortcuts.js`.

- [ ] **Step 4: Run the tests; they pass.** Then run `pnpm --filter @tj/web exec vitest run src/screenshots` (the lightbox still works without a provider).
- [ ] **Step 5: Commit:** `feat(web): one shortcut layer, with the ? help`.

### Task 10: the list you came from

**Files:**
- Create: `apps/web/src/nav/tradeList.ts`, `tradeList.test.ts`, `useTradeNav.ts`, `useTradeNav.test.tsx`, `TradeNavLine.tsx`
- Modify:
  - `apps/web/src/router.tsx`: `openTrade`, the history-state declaration, and the trade route passing `list`;
  - `routes/Journal.tsx`, `Scalps.tsx`, `IronFlies.tsx`, `Dashboard.tsx`, `OverviewTab.tsx`;
  - `missed/MissedPage.tsx`;
  - `review/QueueBar.tsx`;
  - `routes/TradeDetail.tsx`: the `list` prop and the nav line;
  - those files' tests: `QueueBar.test.tsx` expects the queue as the second argument.

**Interfaces (produces):**
```ts
// nav/tradeList.ts
export type TradeList = { kind: "queue" } | { kind: "ids"; ids: readonly string[]; label: string };
export const QUEUE: TradeList;
export type OpenTrade = (id: string, list?: TradeList) => void;
export function readTradeList(state: unknown): TradeList | null;
export function listOf(rows: readonly { id: string }[], label: string): TradeList;
// nav/useTradeNav.ts
export interface TradeNav {
  next: string | null;
  prev: string | null;
  /** Where the trade sits in a list of ids; null for the queue (its bar says) and for no list. */
  place: { position: number; total: number; label: string } | null;
  /** The list J and K carry on; null when they don't apply. */
  list: TradeList | null;
}
/** `tradeId` is the page's: a list carries on past a trade that's gone (spec §9). */
export function useTradeNav(tradeId: string, trade: TradeView | undefined, list: TradeList | null): TradeNav;
// nav/TradeNavLine.tsx
export function TradeNavLine({ nav, error }: { nav: TradeNav; error?: string | null }): JSX.Element | null;
// TradeDetail gains: list?: TradeList | null
```

- [ ] **Step 1: Write the tests.**

`tradeList.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listOf, QUEUE, readTradeList } from "./tradeList.js";

describe("the list in history state", () => {
  it("reads the queue and lists of ids", () => {
    expect(readTradeList({ tradeList: { kind: "queue" } })).toEqual(QUEUE);
    expect(readTradeList({ tradeList: { kind: "ids", ids: ["a", "b"], label: "Journal" } })).toEqual({
      kind: "ids",
      ids: ["a", "b"],
      label: "Journal",
    });
  });

  it.each([null, undefined, {}, { tradeList: "x" }, { tradeList: { kind: "ids", ids: [1], label: "J" } }, { tradeList: { kind: "ids", ids: [] } }])(
    "reads %o as no list",
    (state) => {
      expect(readTradeList(state)).toBeNull();
    },
  );

  it("makes a list from rows", () => {
    expect(listOf([{ id: "a" }, { id: "b" }], "Recent")).toEqual({ kind: "ids", ids: ["a", "b"], label: "Recent" });
  });
});
```

`useTradeNav.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { listOf, QUEUE } from "./tradeList.js";
import { useTradeNav } from "./useTradeNav.js";

const at = (minute: number) => Date.UTC(2026, 8, 28, 13, 30 + minute);
const trade = (id: string, minute: number, extra: Partial<Record<string, unknown>> = {}) =>
  ({ id, openedAt: at(minute), strategy: "scalp", book: "live", review: { status: "pending", missing: ["stop"] }, ...extra }) as unknown as TradeView;
const PENDING = [trade("a", 1), trade("b", 5), trade("c", 9)];

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
afterEach(() => vi.unstubAllGlobals());
const stubQueue = () =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(PENDING), { headers: { "content-type": "application/json" } })));

describe("useTradeNav", () => {
  it("steps through a list of ids without wrapping", () => {
    stubQueue();
    const list = listOf([{ id: "x" }, { id: "y" }, { id: "z" }], "Journal · Paper");
    const middle = renderHook(() => useTradeNav("y", trade("y", 3), list), { wrapper }).result.current;
    expect(middle).toEqual({ next: "z", prev: "x", place: { position: 2, total: 3, label: "Journal · Paper" }, list });
    const last = renderHook(() => useTradeNav("z", trade("z", 3), list), { wrapper }).result.current;
    expect(last.next).toBeNull();
    expect(last.prev).toBe("y");
  });

  it("follows the live queue, which wraps", async () => {
    stubQueue();
    const { result } = renderHook(() => useTradeNav("c", trade("c", 9), QUEUE), { wrapper });
    await waitFor(() => expect(result.current.next).toBe("a"));
    expect(result.current).toEqual({ next: "a", prev: "b", place: null, list: QUEUE });
  });

  it("falls back to the queue for a scalp with no list, or one not in its list", async () => {
    stubQueue();
    const none = renderHook(() => useTradeNav("b", trade("b", 5), null), { wrapper });
    await waitFor(() => expect(none.result.current.next).toBe("c"));
    expect(none.result.current.list).toEqual(QUEUE);
    const stray = renderHook(() => useTradeNav("b", trade("b", 5), listOf([{ id: "q" }], "Recent")), { wrapper });
    await waitFor(() => expect(stray.result.current.next).toBe("c"));
  });

  it("keeps a list going past a trade that's gone", () => {
    stubQueue();
    const list = listOf([{ id: "x" }, { id: "gone" }, { id: "z" }], "Journal");
    const { result } = renderHook(() => useTradeNav("gone", undefined, list), { wrapper });
    expect(result.current).toEqual({ next: "z", prev: "x", place: { position: 2, total: 3, label: "Journal" }, list });
  });

  it("gives an iron fly or a missed trade with no list nothing", () => {
    stubQueue();
    const fly = renderHook(() => useTradeNav("f", trade("f", 1, { strategy: "iron_fly", review: null }), null), { wrapper });
    expect(fly.result.current).toEqual({ next: null, prev: null, place: null, list: null });
    const missed = renderHook(() => useTradeNav("m", trade("m", 1, { book: "missed", review: null }), null), { wrapper });
    expect(missed.result.current.list).toBeNull();
  });
});
```

Extend `Journal.test.tsx` with:
- a row's click calls `onOpenTrade(id, { kind: "ids", ids: [every row's id, in order], label: "Journal" })`;
- with PAPER pressed, the label is "Journal · Paper";
- the To review table (`lockedFilter={{ strategy: "scalp", review: "pending" }}`, title "To review") passes `QUEUE`.

In `QueueBar.test.tsx`, the first test's last expectation becomes `[["c", QUEUE], ["a", QUEUE]]`, and the wrap test's `toHaveBeenCalledWith("a", QUEUE)`.

In `TradeDetail.test.tsx`, add: rendered with `list={listOf([{ id: "p" }, { id: <the test trade's id> }, { id: "n" }], "Journal")}`, `screen.getByTestId("trade-nav").textContent` contains "2 of 3 · Journal".

- [ ] **Step 2: Run them; they fail:** `pnpm --filter @tj/web exec vitest run src/nav src/routes/Journal.test.tsx src/review/QueueBar.test.tsx src/routes/TradeDetail.test.tsx`.
- [ ] **Step 3: Implement.**

`nav/tradeList.ts`:

```ts
/** Where J and K go from a trade's page (launcher-keys-palette spec §5): the live queue, or a list's snapshot. */
export type TradeList = { kind: "queue" } | { kind: "ids"; ids: readonly string[]; label: string };

export const QUEUE: TradeList = { kind: "queue" };

/** Opens a trade, with the list it was opened from. */
export type OpenTrade = (id: string, list?: TradeList) => void;

/** The list in a history entry's state. Anything else, such as an entry from before this change, is none. */
export function readTradeList(state: unknown): TradeList | null {
  const list = (state as { tradeList?: unknown } | null | undefined)?.tradeList;
  if (list == null || typeof list !== "object") return null;
  const { kind, ids, label } = list as { kind?: unknown; ids?: unknown; label?: unknown };
  if (kind === "queue") return QUEUE;
  if (kind !== "ids" || typeof label !== "string" || !Array.isArray(ids)) return null;
  return ids.every((id) => typeof id === "string") ? { kind: "ids", ids: ids as string[], label } : null;
}

/** A list of rows, in the order shown. */
export const listOf = (rows: readonly { id: string }[], label: string): TradeList => ({
  kind: "ids",
  ids: rows.map((row) => row.id),
  label,
});
```

`nav/useTradeNav.ts`:

```ts
import type { TradeView } from "../api.js";
import { usePendingReviews } from "../review/data.js";
import { queueNav } from "../review/queue.js";
import { QUEUE, type TradeList } from "./tradeList.js";

export interface TradeNav {
  next: string | null;
  prev: string | null;
  /** Where the trade sits in a list of ids; null for the queue (its bar says) and for no list. */
  place: { position: number; total: number; label: string } | null;
  /** The list J and K carry on; null when they don't apply. */
  list: TradeList | null;
}

const NONE: TradeNav = { next: null, prev: null, place: null, list: null };

/**
 * Next and previous from a trade's page (spec §5): a list of ids in its order, not wrapping; the live queue,
 * wrapping, as the queue bar does; and for a scalp opened from no list, the queue.
 */
export function useTradeNav(tradeId: string, trade: TradeView | undefined, list: TradeList | null): TradeNav {
  const { data: pending = [] } = usePendingReviews();
  if (list?.kind === "ids") {
    // By the page's id, so a list carries on past a trade deleted since it was opened (spec §9).
    const at = list.ids.indexOf(tradeId);
    if (at >= 0) {
      return {
        next: list.ids[at + 1] ?? null,
        prev: at > 0 ? (list.ids[at - 1] ?? null) : null,
        place: { position: at + 1, total: list.ids.length, label: list.label },
        list,
      };
    }
  }
  if (!trade) return NONE;
  const scalp = trade.strategy === "scalp" && trade.book !== "missed";
  if (list?.kind !== "queue" && !scalp) return NONE;
  const nav = queueNav(pending, trade, trade.review?.status === "pending");
  return { next: nav.next, prev: nav.prev, place: null, list: QUEUE };
}
```

`nav/TradeNavLine.tsx`:

```tsx
import type { TradeNav } from "./useTradeNav.js";

/** "4 of 41 · Journal · Paper" (spec §5), and a key's failed save. Nothing for the queue or no list. */
export function TradeNavLine({ nav, error }: { nav: TradeNav; error?: string | null }) {
  if (!nav.place && !error) return null;
  return (
    <div data-testid="trade-nav" className="flex items-center gap-3 text-[11px] text-muted">
      {nav.place && (
        <span className="num">
          {nav.place.position} of {nav.place.total} · {nav.place.label}
        </span>
      )}
      {nav.place && <span>J next · K previous</span>}
      {error && <span className="text-down">Couldn't save: {error}</span>}
    </div>
  );
}
```

`router.tsx`:

```ts
// The list a trade was opened from rides in the history entry (spec §5): it survives a reload and Back.
declare module "@tanstack/react-router" {
  interface HistoryState {
    tradeList?: TradeList;
  }
}

const openTrade: OpenTrade = (id, list) =>
  router.navigate({ to: "/trades/$id", params: { id }, state: { tradeList: list } });
```

In `TradeDetailRoute`, read `const list = readTradeList(useRouterState({ select: (state) => state.location.state }));` and pass `list={list}` to `<TradeDetail>`. Everything else that takes `onOpenTrade={openTrade}` keeps working: `OpenTrade` fits where `(id: string) => void` is expected.

The lists:
- **`Journal.tsx`:**
  - `onOpenTrade?: OpenTrade` in `JournalProps`;
  - add `const BOOK_LABEL = { live: "Live", paper: "Paper", missed: "Missed" } as const;`;
  - before the return:
    ```ts
    const list =
      lockedFilter?.review === "pending" ? QUEUE : listOf(data ?? [], book ? `${title} · ${BOOK_LABEL[book]}` : title);
    ```
  - both `onOpenTrade?.(trade.id)` calls become `onOpenTrade?.(trade.id, list)`.
- **`Scalps.tsx`, `IronFlies.tsx`:** the prop type is `OpenTrade`.
- **`MissedPage.tsx`:** the prop type is `OpenTrade`. Its rows' click and Enter pass `listOf(shown, "Missed")` (`shown` is the array the rows map over).
- **`Dashboard.tsx`:**
  - the prop type is `OpenTrade`, and so is `TradeList`'s and `DayTrades`'s;
  - rename the Dashboard's own `TradeList` component to `TradeRows`, since it would clash with the new type. `TradeRows` gets a `list: TradeList` prop and passes it on each click;
  - `DayTrades` passes `listOf(trades, dayText(date))`;
  - the recent list, `<TradeRows trades={inPeriod.slice(-5).reverse()} … />`, gets `list={listOf(inPeriod.slice(-5).reverse(), "Recent")}`;
  - the open-trades rows (`open.map(…)`, the "opened …" lines) pass `listOf(open, "Open")`;
  - `ToReview`'s "Start reviewing →" and its rows pass `QUEUE`.
- **`OverviewTab.tsx`:** the prop type is `OpenTrade`. The largest-losses rows pass `listOf(losers, "Largest losses")`. Also widen the type in `Analytics.tsx` and `AnalyticsRoute.tsx`.
- **`QueueBar.tsx`:** `onOpenTrade?: OpenTrade`; `go` calls `onOpenTrade?.(id, QUEUE)`.
- **`TradeDetail.tsx`:**
  - add `list?: TradeList | null` to the props (default `null`);
  - after the quotes query, before any early return: `const nav = useTradeNav(tradeId, trade, list ?? null);`;
  - the trade query gets `retry: (failures, error) => !error.message.endsWith(": 404") && failures < 3`, and the loading line becomes:
    ```tsx
    if (!trade) {
      if (isLoading) return <p className="text-muted">Loading…</p>;
      // A trade deleted since its list was opened (spec §9): J and K still go on.
      return (
        <div className="flex flex-col gap-3">
          <TradeNavLine nav={nav} />
          <p className="text-muted">This trade isn't in the journal any more.</p>
        </div>
      );
    }
    ```
    Add a `TradeDetail.test.tsx` case: the trade's fetch answers 404 and the list is `["p", <id>, "n"]`; it shows "This trade isn't in the journal any more." and "2 of 3 · Journal".
  - render `<TradeNavLine nav={nav} />` as the first child of the page's column;
  - the missed branch returns `<div className="flex flex-col gap-3"><TradeNavLine nav={nav} /><MissedWorkspace … /></div>`.

  (Task 11 adds the `error`.)

- [ ] **Step 4: Run the tests; they pass.** Then run the whole web suite: `pnpm --filter @tj/web exec vitest run`.
- [ ] **Step 5: Commit:** `feat(web): J/K's list travels with the trade you open, with "4 of 41 · Journal" on its page`.

### Task 11: the trade page's keys

**Files:**
- Create: `apps/web/src/review/useTradeKeys.ts`, `apps/web/src/review/useTradeKeys.test.tsx`
- Modify:
  - `review/Pickers.tsx`: the setup select's and chip groups' `data-key-target`, and the chips' arrow keys;
  - `review/ReviewPanel.tsx`: the notes' `data-key-target` and the hint;
  - `review/LevelFields.tsx`: `data-key-target` on + Stop and + Target;
  - `missed/MissedWorkspace.tsx`: the place buttons, the notes and the hint;
  - `routes/TradeDetail.tsx`: calls `useTradeKeys` and shows its error.

**Interfaces:**
- Consumes:
  - `useShortcut` (Task 9);
  - `TradeNav`, `OpenTrade` (Task 10);
  - `useSaveTrade` and `TradePatchBody` (`review/data.ts`): `useSaveTrade(id).mutateAsync(body)` rejects with the server's message.
- Produces:
  - `useTradeKeys({ trade, nav, onOpenTrade, chart }): { error: string | null }`;
  - the attribute contract `data-key-target` ∈ `setup | mistake | emotion | skip | notes | place-stop | place-target | place-exit`.

- [ ] **Step 1: Write the tests** (`useTradeKeys.test.tsx`). The harness renders the real review panel, so the fields and attributes are the real ones:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { ShortcutsProvider } from "../keys/Shortcuts.js";
import { listOf, type OpenTrade } from "../nav/tradeList.js";
import type { TradeNav } from "../nav/useTradeNav.js";
import { ReviewPanel } from "./ReviewPanel.js";
import { useTradeKeys } from "./useTradeKeys.js";

const TAGS = [
  { id: "m1", name: "FOMO", kind: "mistake", archived: false },
  { id: "m2", name: "Late", kind: "mistake", archived: false },
  { id: "e1", name: "Calm", kind: "emotion", archived: false },
];
const scalp = (extra: Record<string, unknown> = {}) =>
  ({
    id: "t1",
    strategy: "scalp",
    book: "live",
    grade: null,
    excluded: false,
    notes: null,
    tagIds: [],
    setupId: null,
    reviewedAt: null,
    review: { status: "pending", missing: ["stop"] },
    ...extra,
  }) as unknown as TradeView;
const LIST = listOf([{ id: "t0" }, { id: "t1" }, { id: "t2" }], "Journal");
const NAV: TradeNav = { next: "t2", prev: "t0", place: { position: 2, total: 3, label: "Journal" }, list: LIST };

function Harness({ trade, onOpenTrade, chart, placeStop }: { trade: TradeView; onOpenTrade: OpenTrade; chart: boolean; placeStop: () => void }) {
  const keys = useTradeKeys({ trade, nav: NAV, onOpenTrade, chart });
  return (
    <>
      <ReviewPanel
        trade={trade}
        layout="strip"
        levels={
          <button type="button" data-key-target="place-stop" onClick={placeStop}>
            + Stop
          </button>
        }
      />
      {keys.error && <p data-testid="key-error">{keys.error}</p>}
    </>
  );
}

function setup(trade: TradeView, { chart = true, patchStatus = 200 } = {}) {
  const patches: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return patchStatus === 200 ? json(trade) : json({ message: "nope" }, patchStatus);
      }
      if (url.includes("/api/tags")) return json(TAGS);
      return json([]);
    }),
  );
  const onOpenTrade = vi.fn();
  const placeStop = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ShortcutsProvider>
        <Harness trade={trade} onOpenTrade={onOpenTrade} chart={chart} placeStop={placeStop} />
      </ShortcutsProvider>
    </QueryClientProvider>,
  );
  return { patches, onOpenTrade, placeStop };
}
const press = (key: string, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, code: /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : key });

afterEach(() => vi.unstubAllGlobals());

describe("a trade's keys", () => {
  it("J and K move through the list", () => {
    const { onOpenTrade } = setup(scalp());
    press("j");
    press("k");
    expect(onOpenTrade.mock.calls).toEqual([["t2", LIST], ["t0", LIST]]);
  });

  it("1–5 set the grade, and the trade's own grade clears it", async () => {
    const first = setup(scalp());
    press("1");
    await waitFor(() => expect(first.patches).toEqual([{ grade: "A" }]));
    cleanup();
    vi.unstubAllGlobals();
    const again = setup(scalp({ grade: "F" }));
    press("5");
    await waitFor(() => expect(again.patches).toEqual([{ grade: null }]));
  });

  it("X toggles exclude", async () => {
    const { patches } = setup(scalp());
    press("x");
    await waitFor(() => expect(patches).toEqual([{ excluded: true }]));
  });

  it("Enter marks a queued scalp done, then opens the next", async () => {
    const { patches, onOpenTrade } = setup(scalp());
    press("Enter");
    await waitFor(() => expect(onOpenTrade).toHaveBeenCalledWith("t2", LIST));
    expect(patches).toEqual([{ reviewed: true }]);
  });

  it("Enter on a complete scalp only opens the next", async () => {
    const { patches, onOpenTrade } = setup(scalp({ review: { status: "done", missing: [] } }));
    press("Enter");
    expect(onOpenTrade).toHaveBeenCalledWith("t2", LIST);
    expect(patches).toEqual([]);
  });

  it("Enter after clicking grade B doesn't click B again", async () => {
    const { patches, onOpenTrade } = setup(scalp());
    const b = screen.getByRole("button", { name: "B" });
    fireEvent.pointerDown(b);
    b.focus();
    fireEvent.click(b);
    press("Enter", b);
    await waitFor(() => expect(onOpenTrade).toHaveBeenCalledWith("t2", LIST));
    expect(patches).toEqual([{ grade: "B" }, { reviewed: true }]);
  });

  it("stays, with the reason, when Enter's save fails", async () => {
    const { onOpenTrade } = setup(scalp(), { patchStatus: 400 });
    press("Enter");
    expect((await screen.findByTestId("key-error")).textContent).toBe("nope");
    expect(onOpenTrade).not.toHaveBeenCalled();
  });

  it("S opens the setup list, M and E reach the chips, arrows move, Esc gives the keys back", async () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLSelectElement.prototype, "showPicker", { value: showPicker, configurable: true });
    setup(scalp());
    press("s");
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Setup" }));
    expect(showPicker).toHaveBeenCalledOnce();
    await screen.findByRole("button", { name: "FOMO" });
    press("m");
    expect(document.activeElement?.textContent).toBe("FOMO");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(document.activeElement?.textContent).toBe("Late");
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(document.activeElement).toBe(document.body);
    press("e");
    expect(document.activeElement?.textContent).toBe("Calm");
  });

  it("N focuses the notes, where J types instead of moving", () => {
    const { onOpenTrade } = setup(scalp());
    press("n");
    const notes = screen.getByRole("textbox", { name: "Notes" });
    expect(document.activeElement).toBe(notes);
    press("j", notes);
    expect(onOpenTrade).not.toHaveBeenCalled();
  });

  it("J goes on past a trade that's gone", () => {
    function Gone({ onOpenTrade }: { onOpenTrade: OpenTrade }) {
      useTradeKeys({ trade: undefined, nav: NAV, onOpenTrade, chart: false });
      return null;
    }
    const onOpenTrade = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ShortcutsProvider>
          <Gone onOpenTrade={onOpenTrade} />
        </ShortcutsProvider>
      </QueryClientProvider>,
    );
    press("j");
    expect(onOpenTrade).toHaveBeenCalledWith("t2", LIST);
  });

  it("P places the stop on a page with a chart, and not on one without", () => {
    const withChart = setup(scalp());
    press("p");
    expect(withChart.placeStop).toHaveBeenCalledOnce();
    cleanup();
    vi.unstubAllGlobals();
    const without = setup(scalp(), { chart: false });
    press("p");
    expect(without.placeStop).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them; they fail:** `pnpm --filter @tj/web exec vitest run src/review/useTradeKeys.test.tsx`.
- [ ] **Step 3: Implement `useTradeKeys.ts`:**

```ts
import type { Grade } from "@tj/core";
import { useState } from "react";
import type { TradeView } from "../api.js";
import { useShortcut } from "../keys/Shortcuts.js";
import type { OpenTrade } from "../nav/tradeList.js";
import type { TradeNav } from "../nav/useTradeNav.js";
import { type TradePatchBody, useSaveTrade } from "./data.js";

const field = (name: string) => document.querySelector<HTMLElement>(`[data-key-target="${name}"]`);

/** S, M, E, N (spec §6.2–6.3): the setup's list opens; a chip group's first chip, or the notes, takes focus. */
function focusField(name: string): void {
  const target = field(name);
  if (!target) return;
  if (target instanceof HTMLSelectElement) {
    target.focus();
    try {
      // Its list, where arrows only move the highlight: a focused select would save on every arrow.
      target.showPicker();
    } catch {
      // Not supported, or refused: the focus stays.
    }
    return;
  }
  (target.matches("textarea, input") ? target : target.querySelector<HTMLElement>("button"))?.focus();
}

/**
 * The keys on a trade's page (launcher-keys-palette spec §6.1): J/K, 1–5, Enter, S/M/E/N, P/T, X. Only those that
 * apply are registered, so the ? help shows only those. A failed save leaves `error` for the page to show.
 */
export function useTradeKeys({
  trade,
  nav,
  onOpenTrade,
  chart,
}: {
  trade: TradeView | undefined;
  nav: TradeNav;
  onOpenTrade?: OpenTrade;
  /** Whether the page has a chart to place levels on: scalps and missed trades. */
  chart: boolean;
}): { error: string | null } {
  const save = useSaveTrade(trade?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const ready = trade != null;
  const patch = (body: TradePatchBody) => {
    setError(null);
    return save.mutateAsync(body).then(
      () => true,
      (problem: unknown) => {
        setError(problem instanceof Error ? problem.message : String(problem));
        return false;
      },
    );
  };
  const go = (id: string | null) => {
    if (id) onOpenTrade?.(id, nav.list ?? undefined);
  };
  const grade = (each: Grade) => () => {
    if (trade) void patch({ grade: trade.grade === each ? null : each });
  };
  // J and K also work on a trade that's gone, so a list goes on past it (spec §9).
  const moves = nav.list != null;
  const unfinished =
    trade?.review?.status === "pending" && trade.review.missing.length > 0 && trade.reviewedAt == null;
  const missed = trade?.book === "missed";

  useShortcut(moves ? "j" : null, "Next trade", "Review", () => go(nav.next));
  useShortcut(moves ? "k" : null, "Previous trade", "Review", () => go(nav.prev));
  useShortcut(ready ? "1" : null, "Grade A", "Review", grade("A"));
  useShortcut(ready ? "2" : null, "Grade B", "Review", grade("B"));
  useShortcut(ready ? "3" : null, "Grade C", "Review", grade("C"));
  useShortcut(ready ? "4" : null, "Grade D", "Review", grade("D"));
  useShortcut(ready ? "5" : null, "Grade F", "Review", grade("F"));
  useShortcut(
    moves || (ready && unfinished) ? "Enter" : null,
    unfinished ? "Done, then next" : "Next trade",
    "Review",
    () => {
      if (!unfinished) return go(nav.next);
      void patch({ reviewed: true }).then((saved) => {
        if (saved) go(nav.next);
      });
    },
  );
  useShortcut(ready ? "s" : null, "Setup", "Review", () => focusField("setup"));
  useShortcut(ready ? "m" : null, missed ? "Skip reasons" : "Mistakes", "Review", () =>
    focusField(missed ? "skip" : "mistake"),
  );
  useShortcut(ready ? "e" : null, "Emotion", "Review", () => focusField("emotion"));
  useShortcut(ready ? "n" : null, "Notes", "Review", () => focusField("notes"));
  useShortcut(ready && chart ? "p" : null, "Place the stop", "Chart", () => field("place-stop")?.click());
  useShortcut(ready && chart ? "t" : null, "Place a target", "Chart", () => field("place-target")?.click());
  useShortcut(ready ? "x" : null, "Exclude from stats", "Review", () => {
    if (trade) void patch({ excluded: !trade.excluded });
  });
  return { error };
}
```

- [ ] **Step 4: Add the attributes and the hint.**
  - **`Pickers.tsx`:**
    - the setup `<select>` gets `data-key-target="setup"`;
    - `TagChips`' outer `<span>` gets `data-key-target={kind}` (`mistake`, `emotion` or `skip`) plus `role="group"` and `aria-label={kind === "skip" ? "Skip reasons" : kind === "emotion" ? "Emotion" : "Mistakes"}`;
    - every chip `<button>`, and the `+` button, gets `onKeyDown={chipKeys}`:

    ```ts
    /** Inside a chip group (spec §6.3): ←/→ move between the chips, Esc gives the keys back to the page. */
    function chipKeys(event: React.KeyboardEvent<HTMLButtonElement>) {
      const siblings = Array.from(event.currentTarget.parentElement?.children ?? []);
      const chips = siblings.filter((each): each is HTMLButtonElement => each instanceof HTMLButtonElement);
      const at = chips.indexOf(event.currentTarget);
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        chips[(at + (event.key === "ArrowRight" ? 1 : chips.length - 1)) % chips.length]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.currentTarget.blur();
      }
    }
    ```
  - **`ReviewPanel.tsx`:**
    - the notes `<textarea>` gets `data-key-target="notes"`;
    - add `<span className="text-[10px] text-muted">Press ? for shortcuts</span>`: in the strip's bottom row after `{exclude}`, and as the side layout's last child.
  - **`LevelFields.tsx`:** the + Stop button gets `data-key-target="place-stop"`, and the + Target button `data-key-target="place-target"`.
  - **`MissedWorkspace.tsx`:**
    - the button `place(what, label)` renders gets `data-key-target={`place-${what}`}`;
    - its notes `<textarea>` gets `data-key-target="notes"`;
    - add the hint line under the Exclude checkbox.
  - **`TradeDetail.tsx`:**
    - after `useTradeNav`: `const keys = useTradeKeys({ trade, nav, onOpenTrade, chart: trade != null && (trade.strategy === "scalp" || trade.book === "missed") });`;
    - both `<TradeNavLine nav={nav} />` become `<TradeNavLine nav={nav} error={keys.error} />`.

  The spec (§6.3) says a chip group is one tab stop with a roving focus. This plan keeps every chip in the Tab order as now and adds the arrows and Esc. The keys behave as the spec says, and Tab needs no changes. Ledger it as a ruling, and Task 14 updates the spec.
- [ ] **Step 5: Run the tests; they pass.** Then run the whole web suite. `ReviewPanel`, `MissedWorkspace` and `Pickers` tests may need the new hint line or the group's role in their queries.
- [ ] **Step 6: Commit:** `feat(web): review a trade from the keyboard: J/K, 1–5, Enter, S/M/E/N, P/T, X`.

---

## Part D — The command palette (spec §7)

### Task 12: the palette's query and page matching (pure)

**Files:**
- Create: `apps/web/src/palette/query.ts`, `query.test.ts`, `pages.ts`, `pages.test.ts`

**Interfaces:**
- Consumes: `parseDayMonthYear`, `parseDayMonth`, `addDays`, `nyDate`, `weekdayOfDate` and `WEEKDAYS` from `@tj/core`.
- Produces:

```ts
// query.ts
export type Word =
  | { kind: "day"; date: string }
  | { kind: "month"; month: string }
  | { kind: "strategy"; strategy: "scalp" | "iron_fly" }
  | { kind: "book"; book: "live" | "paper" | "missed" }
  | { kind: "ticker"; ticker: string; exact: boolean }
  | { kind: "setup"; ids: string[]; text: string }
  | { kind: "unknown"; text: string };
export interface QueryContext { today: string; tickers: ReadonlySet<string>; setups: readonly { id: string; name: string }[] }
export interface PaletteTrade { id: string; openedAt: number; underlying: string; strategy: string; book: string; setupId: string | null }
export function parseTradeQuery(text: string, ctx: QueryContext): Word[];
export function matchTrades<T extends PaletteTrade>(trades: readonly T[], words: readonly Word[]): T[];
// pages.ts
export interface PalettePage { label: string; href: string }
export const PAGES: readonly PalettePage[];
export function matchPages(text: string, pages?: readonly PalettePage[]): PalettePage[];
```

**A refinement of spec §7.3's reading order:** a run of **two or more** words that starts a setup's name is read first. So `spy fade` finds the setup "Spy fade", while `spy` alone stays the ticker. After that the spec's order holds: day, month, strategy or book, exact ticker, a one-word setup, ticker prefix. Task 14 writes this into the spec.

- [ ] **Step 1: Write the tests.**

`query.test.ts` (today is Monday 12 Oct 2026):

```ts
import { describe, expect, it } from "vitest";
import { matchTrades, type PaletteTrade, parseTradeQuery, type QueryContext } from "./query.js";

const CTX: QueryContext = {
  today: "2026-10-12",
  tickers: new Set(["NVDA", "SPY", "MSFT"]),
  setups: [
    { id: "s1", name: "ORB breakout" },
    { id: "s2", name: "VWAP reclaim" },
    { id: "s3", name: "Spy fade" },
  ],
};
const read = (text: string) => parseTradeQuery(text, CTX);

describe("parseTradeQuery", () => {
  it.each([
    ["today", "2026-10-12"],
    ["yesterday", "2026-10-11"],
    ["mon", "2026-10-12"],
    ["fri", "2026-10-09"],
    ["sunday", "2026-10-11"],
    ["28/9", "2026-09-28"],
    ["28.09", "2026-09-28"],
    ["9/12", "2025-12-09"],
    ["9/12/26", "2026-12-09"],
    ["28-9-2026", "2026-09-28"],
    ["2026-09-28", "2026-09-28"],
  ])("reads %s as the day %s", (text, date) => {
    expect(read(text)).toEqual([{ kind: "day", date }]);
  });

  it("refuses a US date", () => {
    expect(read("9/28")).toEqual([{ kind: "unknown", text: "9/28" }]);
  });

  it.each([
    ["sep", "2026-09"],
    ["september", "2026-09"],
    ["december", "2025-12"],
    ["2026-09", "2026-09"],
  ])("reads %s as the month %s", (text, month) => {
    expect(read(text)).toEqual([{ kind: "month", month }]);
  });

  it("reads strategies and books", () => {
    expect(read("scalp fly missed paper live")).toEqual([
      { kind: "strategy", strategy: "scalp" },
      { kind: "strategy", strategy: "iron_fly" },
      { kind: "book", book: "missed" },
      { kind: "book", book: "paper" },
      { kind: "book", book: "live" },
    ]);
  });

  it("reads tickers, exact or by prefix, in any case", () => {
    expect(read("NVDA nv")).toEqual([
      { kind: "ticker", ticker: "NVDA", exact: true },
      { kind: "ticker", ticker: "NV", exact: false },
    ]);
  });

  it("reads setups by the start of their name, several words included", () => {
    expect(read("orb breakout")).toEqual([{ kind: "setup", ids: ["s1"], text: "orb breakout" }]);
    expect(read("vwap rec")).toEqual([{ kind: "setup", ids: ["s2"], text: "vwap rec" }]);
    expect(read("orb sep")).toEqual([
      { kind: "setup", ids: ["s1"], text: "orb" },
      { kind: "month", month: "2026-09" },
    ]);
  });

  it("keeps a ticker a ticker unless more words make a setup", () => {
    expect(read("spy")).toEqual([{ kind: "ticker", ticker: "SPY", exact: true }]);
    expect(read("spy fade")).toEqual([{ kind: "setup", ids: ["s3"], text: "spy fade" }]);
  });

  it("calls the rest unknown", () => {
    expect(read("nvda xyz")).toEqual([
      { kind: "ticker", ticker: "NVDA", exact: true },
      { kind: "unknown", text: "xyz" },
    ]);
    expect(read("   ")).toEqual([]);
  });
});

const trade = (id: string, iso: string, extra: Partial<PaletteTrade> = {}): PaletteTrade => ({
  id,
  openedAt: Date.parse(iso),
  underlying: "NVDA",
  strategy: "scalp",
  book: "live",
  setupId: null,
  ...extra,
});
const TRADES = [
  trade("t1", "2026-09-28T13:35:00Z", { setupId: "s1" }),
  trade("t2", "2026-09-28T14:00:00Z", { book: "paper", setupId: "s2" }),
  trade("t3", "2026-09-29T14:00:00Z", { underlying: "SPY", strategy: "iron_fly" }),
  trade("t4", "2026-09-28T15:00:00Z", { book: "missed", setupId: "s1" }),
  // 23:30 in New York on the 28th.
  trade("t5", "2026-09-29T03:30:00Z", { underlying: "MSFT" }),
];
const ids = (text: string) => matchTrades(TRADES, read(text)).map((each) => each.id);

describe("matchTrades", () => {
  it("needs every word, newest first", () => {
    expect(ids("nvda 28/9")).toEqual(["t4", "t2", "t1"]);
    expect(ids("nvda 28/9 paper")).toEqual(["t2"]);
    expect(ids("orb")).toEqual(["t4", "t1"]);
    expect(ids("fly")).toEqual(["t3"]);
    expect(ids("sep missed")).toEqual(["t4"]);
  });

  it("uses New York's day", () => {
    expect(ids("msft 28/9")).toEqual(["t5"]);
  });

  it("shows nothing for an unknown word or an empty query", () => {
    expect(ids("nvda xyz")).toEqual([]);
    expect(ids("")).toEqual([]);
  });
});
```

`pages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matchPages, PAGES } from "./pages.js";

const labels = (text: string) => matchPages(text).map((page) => page.label);

describe("matchPages", () => {
  it("lists every page with nothing typed", () => {
    expect(matchPages("")).toEqual(PAGES);
    expect(PAGES).toHaveLength(13);
  });

  it("matches the start of each word, in order", () => {
    expect(labels("an sc")).toEqual(["Analytics › Scalps"]);
    expect(labels("to rev")).toEqual(["Scalps › To review"]);
    expect(labels("missed")).toEqual(["Missed", "Analytics › Missed"]);
    expect(labels("sc an")).toEqual([]);
    expect(labels("nvda")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them; they fail:** `pnpm --filter @tj/web exec vitest run src/palette`.
- [ ] **Step 3: Implement.**

`query.ts`:

```ts
import { addDays, nyDate, parseDayMonth, parseDayMonthYear, WEEKDAYS, weekdayOfDate } from "@tj/core";

/** One word of a palette query, read (launcher-keys-palette spec §7.3). */
export type Word =
  | { kind: "day"; date: string }
  | { kind: "month"; month: string }
  | { kind: "strategy"; strategy: "scalp" | "iron_fly" }
  | { kind: "book"; book: "live" | "paper" | "missed" }
  | { kind: "ticker"; ticker: string; exact: boolean }
  | { kind: "setup"; ids: string[]; text: string }
  | { kind: "unknown"; text: string };

export interface QueryContext {
  /** New York's today, YYYY-MM-DD. */
  today: string;
  tickers: ReadonlySet<string>;
  setups: readonly { id: string; name: string }[];
}

export interface PaletteTrade {
  id: string;
  openedAt: number;
  underlying: string;
  strategy: string;
  book: string;
  setupId: string | null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const LONG_MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
/** Index into WEEKDAYS (Monday first). */
const WEEKDAY_WORDS: Record<string, number> = {
  mon: 0, monday: 0, tue: 1, tues: 1, tuesday: 1, wed: 2, wednesday: 2, thu: 3, thur: 3, thurs: 3, thursday: 3,
  fri: 4, friday: 4, sat: 5, saturday: 5, sun: 6, sunday: 6,
};
const STRATEGIES: Record<string, "scalp" | "iron_fly"> = {
  scalp: "scalp",
  scalps: "scalp",
  fly: "iron_fly",
  flies: "iron_fly",
  iron: "iron_fly",
};
const BOOKS: Record<string, "live" | "paper" | "missed"> = { live: "live", paper: "paper", missed: "missed" };

function dayOf(word: string, today: string): string | null {
  if (word === "today") return today;
  if (word === "yesterday") return addDays(today, -1);
  const weekday = WEEKDAY_WORDS[word];
  if (weekday !== undefined) {
    // The latest such day on or before today.
    return addDays(today, -((WEEKDAYS.indexOf(weekdayOfDate(today)) - weekday + 7) % 7));
  }
  return parseDayMonthYear(word) ?? parseDayMonth(word, today);
}

function monthOf(word: string, today: string): string | null {
  const iso = /^(\d{4})-(\d{2})$/.exec(word);
  if (iso) return Number(iso[2]) >= 1 && Number(iso[2]) <= 12 ? word : null;
  const at = Math.max(MONTHS.indexOf(word), LONG_MONTHS.indexOf(word));
  if (at < 0) return null;
  // A month with no year is its latest, this one included.
  const year = Number(today.slice(0, 4)) - (at + 1 > Number(today.slice(5, 7)) ? 1 : 0);
  return `${year}-${String(at + 1).padStart(2, "0")}`;
}

function oneWord(word: string, ctx: QueryContext): Word | null {
  const date = dayOf(word, ctx.today);
  if (date) return { kind: "day", date };
  const month = monthOf(word, ctx.today);
  if (month) return { kind: "month", month };
  const strategy = STRATEGIES[word];
  if (strategy) return { kind: "strategy", strategy };
  const book = BOOKS[word];
  if (book) return { kind: "book", book };
  if (ctx.tickers.has(word.toUpperCase())) return { kind: "ticker", ticker: word.toUpperCase(), exact: true };
  return null;
}

/** The longest run of words from `start`, at least `least` long, that starts some setups' names. */
function setupRun(words: readonly string[], start: number, least: number, ctx: QueryContext) {
  for (let end = words.length; end - start >= least; end -= 1) {
    const text = words.slice(start, end).join(" ");
    const ids = ctx.setups.filter((setup) => setup.name.toLowerCase().startsWith(text)).map((setup) => setup.id);
    if (ids.length > 0) return { word: { kind: "setup" as const, ids, text }, end };
  }
  return null;
}

/**
 * Reads a query (spec §7.3, refined in the plan): a setup named by two or more words first; then a day, a month,
 * a strategy or book, an exact ticker, a one-word setup, a ticker prefix; anything else is unknown.
 */
export function parseTradeQuery(text: string, ctx: QueryContext): Word[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const read: Word[] = [];
  let at = 0;
  while (at < words.length) {
    const word = words[at] as string;
    const run = setupRun(words, at, 2, ctx);
    const single = run ? null : oneWord(word, ctx);
    const setup = run ?? (single ? null : setupRun(words, at, 1, ctx));
    if (setup) {
      read.push(setup.word);
      at = setup.end;
      continue;
    }
    if (single) {
      read.push(single);
    } else {
      const upper = word.toUpperCase();
      const prefix = [...ctx.tickers].some((ticker) => ticker.startsWith(upper));
      read.push(prefix ? { kind: "ticker", ticker: upper, exact: false } : { kind: "unknown", text: word });
    }
    at += 1;
  }
  return read;
}

function fits(trade: PaletteTrade, word: Word): boolean {
  switch (word.kind) {
    case "day":
      return nyDate(trade.openedAt) === word.date;
    case "month":
      return nyDate(trade.openedAt).slice(0, 7) === word.month;
    case "strategy":
      return trade.strategy === word.strategy;
    case "book":
      return trade.book === word.book;
    case "ticker":
      return word.exact ? trade.underlying === word.ticker : trade.underlying.startsWith(word.ticker);
    case "setup":
      return trade.setupId != null && word.ids.includes(trade.setupId);
    case "unknown":
      return false;
  }
}

/** The trades every word fits, newest first; none for an empty query or one with an unknown word. */
export function matchTrades<T extends PaletteTrade>(trades: readonly T[], words: readonly Word[]): T[] {
  if (words.length === 0 || words.some((word) => word.kind === "unknown")) return [];
  return trades.filter((trade) => words.every((word) => fits(trade, word))).sort((a, b) => b.openedAt - a.openedAt);
}
```

Biome reformats `WEEKDAY_WORDS` one entry a line; let it.

`pages.ts`:

```ts
/** A page or tab the palette can open (spec §7.2). */
export interface PalettePage {
  label: string;
  href: string;
}

export const PAGES: readonly PalettePage[] = [
  { label: "Dashboard", href: "/" },
  { label: "Journal", href: "/journal" },
  { label: "Iron Flies", href: "/iron-flies" },
  { label: "Missed", href: "/missed" },
  { label: "Playbook", href: "/playbook" },
  { label: "Import / Sync", href: "/import" },
  { label: "Settings", href: "/settings" },
  { label: "Analytics › Overview", href: "/analytics" },
  { label: "Analytics › Scalps", href: "/analytics?tab=scalps" },
  { label: "Analytics › Iron flies", href: "/analytics?tab=flies" },
  { label: "Analytics › Missed", href: "/analytics?tab=missed" },
  { label: "Scalps › All", href: "/scalps" },
  { label: "Scalps › To review", href: "/scalps?tab=review" },
];

/** The pages whose words start with the typed words, in order: "an sc" is Analytics › Scalps. */
export function matchPages(text: string, pages: readonly PalettePage[] = PAGES): PalettePage[] {
  const typed = text.toLowerCase().split(/\s+/).filter(Boolean);
  return pages.filter((page) => {
    const names = page.label.toLowerCase().split(/[\s›/]+/).filter(Boolean);
    let at = 0;
    return typed.every((word) => {
      while (at < names.length && !names[at]?.startsWith(word)) at += 1;
      at += 1;
      return at <= names.length;
    });
  });
}
```

- [ ] **Step 4: Run the tests; they pass.**
- [ ] **Step 5: Commit:** `feat(web): the palette's query (day/month dates, months, setups, tickers) and page matching`.

### Task 13: the palette, Ctrl+K, and the nav's Search button

**Files:**
- Create: `apps/web/src/palette/Palette.tsx`, `apps/web/src/palette/Palette.test.tsx`
- Modify:
  - `apps/web/package.json`: add `"cmdk": "1.1.1"` (exact) with `pnpm --filter @tj/web add cmdk@1.1.1`;
  - `apps/web/src/routes/Journal.tsx`: `useTrades` takes `options: { enabled?: boolean } = {}` and passes `enabled: options.enabled ?? true`;
  - `apps/web/src/components/Shell.tsx`: an `onSearch` prop and the button;
  - `apps/web/src/router.tsx`: `Running` holds the palette;
  - `Shell.test.tsx`: the button.

**Interfaces:**
- Consumes:
  - Task 12's `parseTradeQuery`, `matchTrades`, `matchPages`;
  - `useModalLayer` and `keyName` (Task 9);
  - `OpenTrade` (Task 10);
  - `useTrades` (Journal), `useSetups` (review/data), `todayNy` (market.ts);
  - `contractText` (review/text), `rText` (analytics/format), `Chip`, `Money` (components/ui), `dayText` (core).
- Produces:

```ts
export function usePaletteKey(toggle: () => void): void;   // Ctrl+K / Cmd+K anywhere, fields included
export function Palette(props: { open: boolean; onOpenChange: (open: boolean) => void; onOpenTrade: OpenTrade; onGo: (href: string) => void }): JSX.Element;
```

- [ ] **Step 1: Write the tests** (`Palette.test.tsx`):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ShortcutsProvider, useShortcut } from "../keys/Shortcuts.js";
import { Palette, usePaletteKey } from "./Palette.js";

beforeAll(() => {
  // cmdk scrolls the selected row into view; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn();
});

const trade = (id: string, iso: string, extra: Record<string, unknown> = {}) => ({
  id,
  openedAt: Date.parse(iso),
  underlying: "NVDA",
  strategy: "scalp",
  book: "live",
  setupId: null,
  netPnl: 100,
  legs: [{ strike: 180, right: "C" }],
  risk: { r: 1.2 },
  missedRisk: null,
  ...extra,
});
const TRADES = [
  trade("t1", "2026-09-28T13:35:00Z"),
  trade("t2", "2026-09-28T14:00:00Z", { book: "paper" }),
  trade("t4", "2026-09-28T15:00:00Z", { book: "missed", netPnl: null }),
];

function stub(trades: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown, code = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json" } }));
      if (url.includes("/api/trades")) return trades === "never" ? new Promise<Response>(() => {}) : json(trades, status);
      return json([]);
    }),
  );
}

function Harness({ onOpenTrade = vi.fn(), onGo = vi.fn(), onJ = vi.fn() }) {
  const [open, setOpen] = useState(false);
  usePaletteKey(() => setOpen((now) => !now));
  useShortcut("j", "Next trade", "Review", onJ);
  return (
    <>
      <input aria-label="Elsewhere" />
      <Palette open={open} onOpenChange={setOpen} onOpenTrade={onOpenTrade} onGo={onGo} />
    </>
  );
}
function renderPalette(props: Parameters<typeof Harness>[0] = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ShortcutsProvider>
        <Harness {...props} />
      </ShortcutsProvider>
    </QueryClientProvider>,
  );
}
const open = () => fireEvent.keyDown(screen.getByRole("textbox", { name: "Elsewhere" }), { key: "k", code: "KeyK", ctrlKey: true });
const input = () => screen.getByRole("combobox");
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });

afterEach(() => vi.unstubAllGlobals());

describe("the palette", () => {
  it("opens with Ctrl+K from a field and closes with it, listing the pages", () => {
    stub(TRADES);
    renderPalette();
    open();
    expect(screen.getAllByRole("option")).toHaveLength(13);
    expect(screen.getByText("↑↓ move · Enter open · Esc close")).toBeTruthy();
    fireEvent.keyDown(input(), { key: "k", code: "KeyK", ctrlKey: true });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("finds trades newest first, and Enter opens one with every match as its list", async () => {
    stub(TRADES);
    const onOpenTrade = vi.fn();
    renderPalette({ onOpenTrade });
    open();
    type("nvda 28/9");
    await screen.findByText("Trades · 3");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onOpenTrade).toHaveBeenCalledWith("t4", { kind: "ids", ids: ["t4", "t2", "t1"], label: "nvda 28/9" });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("goes to a page", () => {
    stub(TRADES);
    const onGo = vi.fn();
    renderPalette({ onGo });
    open();
    type("an sc");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onGo).toHaveBeenCalledWith("/analytics?tab=scalps");
  });

  it("says which word matches nothing", async () => {
    stub(TRADES);
    renderPalette();
    open();
    type("nvda xyz");
    expect(await screen.findByText("No trades match 'xyz'")).toBeTruthy();
  });

  it("shows the first 50 and says how many more", async () => {
    stub(Array.from({ length: 60 }, (_, i) => trade(`s${i}`, `2026-09-${String((i % 28) + 1).padStart(2, "0")}T14:00:00Z`, { underlying: "SPY" })));
    renderPalette();
    open();
    type("spy");
    expect(await screen.findByText("+10 more · keep typing to narrow")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(50);
  });

  it("types J into its search instead of moving trades", () => {
    stub(TRADES);
    const onJ = vi.fn();
    renderPalette({ onJ });
    open();
    fireEvent.keyDown(input(), { key: "j", code: "KeyJ" });
    fireEvent.keyDown(document.body, { key: "j", code: "KeyJ" });
    expect(onJ).not.toHaveBeenCalled();
  });

  it("says when trades are loading", async () => {
    stub("never");
    renderPalette();
    open();
    type("nvda");
    expect(await screen.findByText("Loading trades…")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("says when trades couldn't load, and the pages still work", async () => {
    stub({ error: "boom" }, 500);
    renderPalette();
    open();
    type("set");
    await waitFor(() => expect(screen.getByText("Couldn't load trades")).toBeTruthy());
    expect(screen.getByRole("option", { name: "Settings" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them; they fail:** `pnpm --filter @tj/web exec vitest run src/palette/Palette.test.tsx`.
- [ ] **Step 3: Implement `Palette.tsx`:**

```tsx
import { dayText } from "@tj/core";
import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TradeView } from "../api.js";
import { rText } from "../analytics/format.js";
import { Chip, Money } from "../components/ui.js";
import { keyName } from "../keys/keyName.js";
import { useModalLayer } from "../keys/Shortcuts.js";
import { todayNy } from "../market.js";
import type { OpenTrade } from "../nav/tradeList.js";
import { useSetups } from "../review/data.js";
import { contractText } from "../review/text.js";
import { useTrades } from "../routes/Journal.js";
import { matchPages } from "./pages.js";
import { matchTrades, parseTradeQuery } from "./query.js";

const SHOWN = 50;
const NO_TRADES: TradeView[] = [];

/** Ctrl+K, or Cmd+K on a Mac, anywhere: fields included, and taken from the browser's own search bar (spec §7.1). */
export function usePaletteKey(toggle: () => void): void {
  const latest = useRef(toggle);
  latest.current = toggle;
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || keyName(event) !== "k") return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, []);
}

function TradeRow({ trade, setup }: { trade: TradeView; setup: string | undefined }) {
  const r = trade.risk?.r ?? trade.missedRisk?.r ?? null;
  return (
    <span className="flex w-full items-center gap-2">
      <span className="num w-14 shrink-0 text-muted">{dayText(trade.openedAt)}</span>
      <span className="num w-32 shrink-0 text-fg">{contractText(trade)}</span>
      <Chip tone={trade.strategy}>{trade.strategy === "iron_fly" ? "IRON FLY" : "SCALP"}</Chip>
      <Chip tone={trade.book}>{trade.book.toUpperCase()}</Chip>
      <span className="min-w-0 flex-1 truncate text-muted">{setup ?? ""}</span>
      {trade.book !== "missed" && <Money value={trade.netPnl} />}
      <span className="num w-14 shrink-0 text-right">{r == null ? "—" : rText(r)}</span>
    </span>
  );
}

const ITEM = "cursor-pointer rounded-sm px-2 py-1 text-fg data-[selected=true]:bg-[#1c2130]";
const NOTE = "px-2 py-1 text-muted";

/** Ctrl+K (launcher-keys-palette spec §7): pages and tabs, and trades by ticker, day, month, setup, strategy, book. */
export function Palette({
  open,
  onOpenChange,
  onOpenTrade,
  onGo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTrade: OpenTrade;
  onGo: (href: string) => void;
}) {
  const [query, setQuery] = useState("");
  useModalLayer(open);
  const trades = useTrades({}, { enabled: open });
  const { data: setups = [] } = useSetups();
  const today = todayNy();
  const all = trades.data ?? NO_TRADES;
  const context = useMemo(
    () => ({ today, tickers: new Set(all.map((trade) => trade.underlying)), setups }),
    [today, all, setups],
  );
  const words = useMemo(() => parseTradeQuery(query, context), [query, context]);
  const found = useMemo(() => matchTrades(all, words), [all, words]);
  const unknown = words.find((word) => word.kind === "unknown");
  const pages = matchPages(query);
  const setupName = new Map(setups.map((setup) => [setup.id, setup.name]));
  const typed = query.trim();

  const close = () => {
    onOpenChange(false);
    setQuery("");
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      label="Search pages and trades"
      shouldFilter={false}
      loop
      overlayClassName="fixed inset-0 z-40 bg-black/50"
      contentClassName="fixed top-24 left-1/2 z-50 w-[680px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-sm border border-line bg-panel text-[12px] shadow-xl"
    >
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder="A page, or a ticker, day (28/9), month, setup…"
        className="w-full border-line border-b bg-transparent px-3 py-2 text-fg outline-none"
      />
      <Command.List className="max-h-[60vh] overflow-y-auto p-1">
        {pages.length > 0 && (
          <Command.Group heading="Pages" className="text-[10px] text-muted uppercase tracking-wider">
            {pages.map((page) => (
              <Command.Item
                key={page.href}
                value={`page ${page.href}`}
                onSelect={() => {
                  close();
                  onGo(page.href);
                }}
                className={`${ITEM} text-[12px] normal-case tracking-normal`}
              >
                {page.label}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {/* Until the trades load, no ticker is known, so every word would read as unknown. */}
        {typed !== "" && trades.isLoading && <p className={NOTE}>Loading trades…</p>}
        {typed !== "" && trades.error && <p className="px-2 py-1 text-down">Couldn't load trades</p>}
        {typed !== "" && trades.data && unknown && <p className={NOTE}>No trades match '{unknown.text}'</p>}
        {found.length > 0 && (
          <Command.Group heading={`Trades · ${found.length}`} className="text-[10px] text-muted uppercase tracking-wider">
            {found.slice(0, SHOWN).map((trade) => (
              <Command.Item
                key={trade.id}
                value={`trade ${trade.id}`}
                onSelect={() => {
                  close();
                  onOpenTrade(trade.id, { kind: "ids", ids: found.map((each) => each.id), label: typed });
                }}
                className={`${ITEM} text-[12px] normal-case tracking-normal`}
              >
                <TradeRow trade={trade} setup={trade.setupId ? setupName.get(trade.setupId) : undefined} />
              </Command.Item>
            ))}
            {found.length > SHOWN && (
              <p className={`${NOTE} normal-case tracking-normal`}>+{found.length - SHOWN} more · keep typing to narrow</p>
            )}
          </Command.Group>
        )}
      </Command.List>
      <div className="border-line border-t px-3 py-1 text-[10px] text-muted">↑↓ move · Enter open · Esc close</div>
    </Command.Dialog>
  );
}
```

If cmdk's group heading text lands in the test's `findByText("Trades · 3")` with extra whitespace, query the heading by `screen.findByText((_, el) => el?.textContent === "Trades · 3")`. Keep the text itself as written.

`Shell.tsx`: add `onSearch?: () => void` to the props. Above the `<nav>`:

```tsx
        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            className="mb-3 flex w-full items-center justify-between rounded-sm border border-line px-2 py-1 text-muted hover:text-fg"
          >
            <span>Search · </span>
            <kbd className="num text-[10px]">Ctrl K</kbd>
          </button>
        )}
```

That gives the accessible name "Search · Ctrl K". Add to `Shell.test.tsx`: with `onSearch`, the button "Search · Ctrl K" calls it on click; without it, there's no button.

`router.tsx`, in `Running`:

```tsx
  const [palette, setPalette] = useState(false);
  usePaletteKey(() => setPalette((open) => !open));
  return (
    <ShortcutsProvider>
      <Shell activePath={pathname} syncing={syncing} toReview={toReview} onSearch={() => setPalette(true)}>
        <Outlet />
      </Shell>
      <Palette open={palette} onOpenChange={setPalette} onOpenTrade={openTrade} onGo={(href) => router.navigate({ href })} />
    </ShortcutsProvider>
  );
```

- [ ] **Step 4: Run the tests; they pass.** Then `pnpm format`, `pnpm lint`, `pnpm typecheck`, and the whole web suite.
- [ ] **Step 5: Check the build:** `pnpm build`. cmdk and Radix add to the bundle; the existing chunk-size warning is known.
- [ ] **Step 6: Commit:** `feat(web): Ctrl+K palette for pages, tabs and trades`.

---

## Part E — Docs and the live check

### Task 14: docs, screenshots, and the live check

**Files:**
- Modify:
  - `docs/superpowers/specs/2026-10-12-launcher-keyboard-palette-design.md`: the plan's refinements, and a §13 live check;
  - `docs/superpowers/specs/2026-09-22-trading-journal-design.md`: §3, §4, §10, §13, as spec §11 lists;
  - `README.md`;
  - `docs/images/*.png`.

- [ ] **Step 1: The spec's refinements,** each in its own section's words:
  - §6.3: chips keep their Tab order, and the arrows and Esc are added (Task 11's ruling).
  - §7.3: a setup run of two or more words is read first (Task 12).
  - §5: the "4 of 41 · Journal" line sits at the top of the trade page.
  - §8.1:
    - there's no `expiryText`: contracts use `dayText` on the expiry;
    - `monthName` and `clockText` are added;
    - "Times stay 24-hour, as they are now" becomes "Times are 24-hour. The Journal, the trade page, estimates and the equity curve's crosshair were 12-hour, and change."
  - §3.2: a journal answering the old `{ ok: true }` counts as the journal, so the first click after this update doesn't report the port as taken.
- [ ] **Step 2: The parent spec,** as spec §11 lists: §3 (PWA row), §4 (runtime), §10 (the palette line points to this spec, plus the dates line), §13 Phase 3 item 4.
- [ ] **Step 3: README.**
  - **"Run it yourself"** leads with:
    ```bash
    pnpm install
    pnpm launcher:install   # once per machine: adds a Trading Journal icon
    ```
    "Then open the journal from its icon: it starts in the background and opens your browser. **Settings → Stop the journal** stops it. `pnpm start` still runs it in a terminal."
  - **A "Keyboard" paragraph:** "Ctrl+K finds any page or trade (`nvda 28/9`, `sep missed`, `orb`). On a trade, J/K move through the list you opened it from, 1–5 grade, Enter marks it done and opens the next, and ? lists every key."
  - **"Known limitations"** gains: "Clicking the icon while the journal is open opens a second tab."
- [ ] **Step 4: Screenshots.**
  - Run `pnpm demo --end 2026-09-30`.
  - With puppeteer-core and headless Firefox (the visual-check recipe: the scratchpad's `pp/`, waiting for `document.fonts.ready` and 500 ms), retake every image in `docs/images/` at 1440×900, so they show day-first dates:
    - `dashboard.png` (`/`);
    - `journal.png` (`/journal`);
    - `scalp.png` (the same winning live scalp, from `/api/trades?strategy=scalp`);
    - `analytics.png` (`/analytics?tab=scalps`);
    - `iron-flies-analytics.png` (`/analytics?tab=flies`);
    - `iron-fly.png` (an iron fly's page);
    - `missed.png` (`/missed`).
  - Also take, for the check only (not committed):
    - the palette open on "nvda sep";
    - the ? help on a scalp;
    - a trade opened from the Journal, showing "N of M · Journal";
    - Settings with the Journal panel and the IBKR date field.
  - Look at each one. Look for any "Sep 28"-style date left: there should be none.
- [ ] **Step 5: Live check, on this machine,** against a copy of the real journal (`TJ_DATA_DIR` set to a scratch copy, port 4391):
  1. Run `node --import tsx src/launch/main.ts --pnpm "$(command -v pnpm)" --data-dir <copy> --port 4391` from `apps/server`, cold. Time it.
  2. Run it again warm: no second server.
  3. Make an empty commit on a scratch branch and run it: restarted. Then drop the commit.
  4. `POST /api/shutdown`: the port frees.
  5. Run it with the port held by `python3 -m http.server 4391`: the error page opens with "Port 4391 is used by another program…".
  6. In headless Firefox on the copy, review three queued scalps by keys only:
     - J, 2, S then Enter on a setup, P then a chart click, then Enter;
     - check the grades, setups and stops saved, and that "REVIEWED ✓" follows.
- [ ] **Step 6: Record the live check** in a §13 of the spec: what ran, the times, and anything fixed. Fix what it finds test-first, and ledger each fix.
- [ ] **Step 7: Commit:** `docs: the launcher, keys and palette in the README and specs; screenshots with European dates`.
- [ ] **Step 8: For the user** (the final message, after the PR is up):
  - click the icon on Fedora;
  - run `pnpm launcher:install` on Windows and click it there;
  - review a morning by keyboard on a Greek layout.

---

## After the tasks

1. **Final review:** a fresh Opus reviewer over the whole branch (`git diff main...HEAD`) with the spec and this plan. Fix its Critical and Important findings test-first, and ledger the Minors.
2. **Full checks:** `pnpm format`, `pnpm lint`, `pnpm typecheck` and `pnpm test`, with the counts in the ledger.
3. **Ship it:**
   - push;
   - `gh pr create` against `main`, the body ending with the session's PR attribution line;
   - `gh pr checks <N> --watch` in the background (Ubuntu and Windows);
   - **ask the user before merging.**
