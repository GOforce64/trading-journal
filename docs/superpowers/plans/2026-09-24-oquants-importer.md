# oQuants Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bulk-import the user's earnings iron flies from oQuants (a DevTools snippet copies the table's cell text, the journal parses and inserts it), re-runnable so later runs only add new trades.

**Architecture:** A plain-JS snippet reads raw cell text from the oQuants Portfolio table and copies JSON to the clipboard. A new pure package `@tj/importers` turns that payload into `NewTrade` objects with deterministic UUIDv5 ids. The server previews (new / already imported / skipped) and commits new trades in one transaction after a `VACUUM INTO` backup. The web Import page is a paste box, a preview table and an Import button.

**Tech Stack:** TypeScript, zod 4, Hono + `@hono/zod-validator`, drizzle-orm on better-sqlite3, React 19 + TanStack Query/Router, Vitest (jsdom for web), Biome.

**Spec:** `docs/superpowers/specs/2026-09-23-oquants-importer-design.md`

## Global Constraints

- Real oQuants captures (`~/.local/share/trading-journal-dev/oquants-captures/`) must never be committed; fixtures are synthetic (ticker `XYZ`, "Example Corp").
- Every imported trade: `strategy: "iron_fly"`, `book: "paper"`, `source: "oquants_extract"`, `feesOpen: null`, `feesClose: null`, `editedAt: null`.
- Only rows whose Strategy cell is exactly `Earnings` are imported.
- Import never modifies an existing trade; an id already in the database (including soft-deleted) is "already imported".
- Payload `format` is exactly `"oquants-cells/1"`.
- Cells are read by header label, never by index or CSS class.
- Skip reasons (exact text): `strategy <value>`, `no call wing — unlimited risk, enter manually`, `unrecognized structure`, `unparseable date "<text>"`, `unparseable number "<text>"`, `fees came out negative ($<x>)`, `duplicate row`, `missing leg P&L`, `leg <Type> <strike> is missing from the designer link`, `invalid trade: <zod message>`.
- Flags (exact text): `1 wing`, `doesn't reconcile ($<x>)` — preview only, never stored.
- Backups keep the last 10 files in the data directory's `backups/`.
- CI runs on Ubuntu and Windows: build paths with `node:path` / `fileURLToPath`, never string concatenation.
- Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before every commit; all three must pass.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- The same trade collected twice (a page read twice) → second copy skipped as `duplicate row`, never a primary-key crash. Test: Task 4.
- A trade opened in late December expiring in January → open year is the previous year, close rolls into the new year. Test: Task 4.
- Pasting something that is not JSON into the Import page → a friendly message, no request sent. Test: Task 7.
- Money with thousands separators (`-1,192.00`) → parsed correctly. Test: Task 4 (the default fixture uses it).
- Running the import when nothing is new → `0 trades imported`, no backup file written, no error. Test: Task 6.

---

### Task 1: Allow a theoretical put wing at strike 0 in core

**Files:**
- Modify: `packages/core/src/model.ts` (the `putWingStrike` line in `ironFlyDetailsSchema`)
- Modify: `packages/core/src/position.ts` (`ironFlyStructureFromLegs`)
- Test: `packages/core/src/model.test.ts`, `packages/core/src/position.test.ts`

**Interfaces:**
- Produces: `ironFlyDetailsSchema.putWingStrike` accepts `0`; `ironFlyStructureFromLegs(legs)` returns `putWingStrike: 0` when there is no long put, and `null` only when a short call, short put or long call is missing.

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/model.test.ts`, inside `describe("newTradeSchema", ...)`, add:

```ts
  it("accepts a theoretical put wing at strike 0 for a 1-wing trade", () => {
    const oneWing = { ...sampleFly, ironFly: { ...sampleFly.ironFly, putWingStrike: 0 } };
    expect(newTradeSchema.parse(oneWing).ironFly?.putWingStrike).toBe(0);
  });

  it("rejects a negative put wing", () => {
    const broken = { ...sampleFly, ironFly: { ...sampleFly.ironFly, putWingStrike: -1 } };
    expect(newTradeSchema.safeParse(broken).success).toBe(false);
  });
```

In `packages/core/src/position.test.ts`, replace the test `"returns null when the four legs of a fly are not all there"` with:

```ts
  it("treats a missing long put as a theoretical wing at strike 0", () => {
    expect(ironFlyStructureFromLegs([shortCall, shortPut, longCall])).toEqual({
      bodyPutStrike: 50,
      bodyCallStrike: 50,
      putWingStrike: 0,
      callWingStrike: 58,
    });
  });

  it("returns null without a long call, since that side's risk is unlimited", () => {
    expect(ironFlyStructureFromLegs([shortCall, shortPut, longPut])).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core`
Expected: FAIL — the strike-0 schema test fails (`positive()`), and the missing-long-put test gets `null`.

- [ ] **Step 3: Implement**

In `packages/core/src/model.ts`, change the `putWingStrike` line of `ironFlyDetailsSchema` to:

```ts
  /** 0 marks a 1-wing trade: with no long put, the stock going to zero caps the put side. */
  putWingStrike: z.number().nonnegative(),
```

In `packages/core/src/position.ts`, replace the body of `ironFlyStructureFromLegs` from the `if (!shortCall ...` line down to its closing `}` with:

```ts
  // Without a long call the upside is unlimited, which this model does not cover.
  if (!shortCall || !shortPut || !longCall) return null;
  return {
    bodyPutStrike: shortPut.strike,
    bodyCallStrike: shortCall.strike,
    // A 1-wing trade: the stock cannot fall below zero, so 0 is the put side's wing.
    putWingStrike: longPut?.strike ?? 0,
    callWingStrike: longCall.strike,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/core
git commit -m "feat(core): allow a theoretical put wing at 0 for 1-wing trades

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Let the builder edit imported trades safely

Imported trades can have no long put, a structure other than "Short Iron Butterfly", and `sourceNotes`. Today the builder demands four legs, hard-codes the structure label, and a save wipes `sourceNotes` (the repository replaces iron-fly details wholesale).

**Files:**
- Modify: `apps/web/src/routes/IronFlyForm.tsx`
- Modify: `apps/web/src/routes/EditTrade.tsx`
- Test: `apps/web/src/routes/IronFlyForm.test.tsx`, `apps/web/src/routes/EditTrade.test.tsx`

**Interfaces:**
- Consumes: Task 1's `ironFlyStructureFromLegs` (missing long put → `putWingStrike: 0`).
- Produces: `IronFlyFormValues.structureLabel: string`; a blank long-put row means a 1-wing trade.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/routes/IronFlyForm.test.tsx`, inside `describe("IronFlyForm", ...)`, add:

```ts
  it("saves a 1-wing trade when the long put is left blank", () => {
    const { onSubmit } = setup();
    priceTheSampleFly();
    for (const field of ["strike", "size", "entry", "exit"]) fill(`Long put ${field}`, "");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));

    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload.legs).toHaveLength(3);
    expect(payload.ironFly.putWingStrike).toBe(0);
  });

  it("keeps the structure label it was given", () => {
    const { onSubmit } = setup({ structureLabel: "Short Iron Condor" });
    priceTheSampleFly();
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    expect(onSubmit.mock.calls[0]?.[0].structureLabel).toBe("Short Iron Condor");
  });
```

In `apps/web/src/routes/EditTrade.test.tsx`, inside `describe("EditTrade", ...)`, add:

```ts
  it("keeps the imported source notes and structure label when saving", async () => {
    const imported = {
      ...trade,
      structureLabel: "Short Iron Condor",
      ironFly: { ...trade.ironFly, sourceNotes: "from oQuants", creditPerShare: 1, netCost: -300 },
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(imported), { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { onSaved } = setup();
    await waitFor(() => expect(screen.getByLabelText("Short call exit")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("t1"));
    const patch = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "PATCH");
    const body = JSON.parse(String(patch?.[1]?.body));
    expect(body.structureLabel).toBe("Short Iron Condor");
    expect(body.ironFly.sourceNotes).toBe("from oQuants");
    expect(body.ironFly.putWingStrike).toBe(25);
    expect(body.ironFly.tradeId).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/web/src/routes/IronFlyForm.test.tsx apps/web/src/routes/EditTrade.test.tsx`
Expected: FAIL — the 1-wing save reports "Every leg needs…" (no submit), the label is "Short Iron Butterfly", and `sourceNotes` is missing.

- [ ] **Step 3: Implement the form changes**

In `apps/web/src/routes/IronFlyForm.tsx`:

Add `structureLabel: string;` to `IronFlyFormValues` (after `underlyingName`), and `structureLabel: "Short Iron Butterfly",` to `EMPTY` (after `underlyingName: ""`).

In `toPricedLegs`, add a blank-row check at the top of the loop:

```ts
const isBlank = (fields: LegFields) => Object.values(fields).every((value) => value.trim() === "");

/** Legs are only priced once strike, size and entry are all present. */
function toPricedLegs(values: IronFlyFormValues): PricedLeg[] | null | "fractional-size" {
  const legs: PricedLeg[] = [];
  for (const role of LEG_ROLES) {
    const fields = values.legs[role.key];
    // A 1-wing trade has no long put; its put wing then counts as strike 0.
    if (role.key === "longPut" && isBlank(fields)) continue;
    const strike = num(fields.strike);
```

(The rest of the loop body is unchanged.)

In `submit()`, change `structureLabel: "Short Iron Butterfly",` to:

```ts
      structureLabel: values.structureLabel || "Short Iron Butterfly",
```

Under the position `</table>`, before the fees grid, add:

```tsx
          <p className="mt-1 text-[10px] text-muted">
            Leave the long put blank for a 1-wing trade: the put wing counts as strike 0.
          </p>
```

Change the Derived panel's empty message from `Price all four legs to see the numbers.` to `Price the legs to see the numbers.`

- [ ] **Step 4: Implement the EditTrade changes**

In `apps/web/src/routes/EditTrade.tsx`, in `toFormValues`, add after `underlyingName`:

```ts
    structureLabel: trade.structureLabel ?? "Short Iron Butterfly",
```

Add this function above `EditTrade`:

```ts
/**
 * The builder only knows the position, but saving replaces the iron-fly details
 * wholesale, so carry over what it cannot see (source notes, earnings data).
 */
function keepIronFlyExtras(payload: Record<string, unknown>, trade: TradeView): Record<string, unknown> {
  if (!trade.ironFly || !payload.ironFly) return payload;
  const { tradeId: _tradeId, ...stored } = trade.ironFly;
  return { ...payload, ironFly: { ...stored, ...(payload.ironFly as Record<string, unknown>) } };
}
```

and change the form's `onSubmit` to:

```tsx
      onSubmit={(payload) => save.mutate(keepIronFlyExtras(payload, trade))}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run apps/web`
Expected: PASS (all web tests, including the existing ones)

- [ ] **Step 6: Commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web
git commit -m "feat(web): edit 1-wing and imported trades without losing their details

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Scaffold `@tj/importers` with the payload schema, UUIDv5 and time helpers

**Files:**
- Create: `packages/importers/package.json`, `packages/importers/tsconfig.json`
- Create: `packages/importers/src/index.ts`
- Create: `packages/importers/src/oquants/payload.ts`, `packages/importers/src/oquants/ids.ts`, `packages/importers/src/oquants/time.ts`
- Modify: `tsconfig.json` (root references)
- Test: `packages/importers/src/oquants/payload.test.ts`, `packages/importers/src/oquants/ids.test.ts`, `packages/importers/src/oquants/time.test.ts`

**Interfaces:**
- Produces:
  - `OQUANTS_FORMAT = "oquants-cells/1"`
  - `oquantsPayloadSchema` (zod) and `type OquantsPayload`, `type OquantsTradeCells = OquantsPayload["trades"][number]`
  - `class OquantsFormatError extends Error`
  - `uuidV5(name: string, namespace: string): string`, `OQUANTS_NAMESPACE: string`
  - `interface MonthDayTime { month: number /* 1-12 */; day: number; hour: number /* 0-23 */; minute: number }`
  - `parseOquantsDate(text: string): MonthDayTime | null`
  - `zonedTimeToEpoch(year: number, time: MonthDayTime, timeZone: string): number`

- [ ] **Step 1: Create the package**

`packages/importers/package.json`:

```json
{
  "name": "@tj/importers",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/oquants/fixture.ts"
  },
  "dependencies": {
    "@tj/core": "workspace:*",
    "zod": "^4.0.0"
  }
}
```

`packages/importers/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

`packages/importers/src/index.ts`:

```ts
export * from "./oquants/ids.js";
export * from "./oquants/payload.js";
export * from "./oquants/time.js";
```

In the root `tsconfig.json`, add `{ "path": "packages/importers" }` to `references`, after `packages/db`.

Run: `pnpm install`
Expected: links `@tj/importers` into the workspace with no errors.

- [ ] **Step 2: Write the failing tests**

`packages/importers/src/oquants/ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { uuidV5 } from "./ids.js";

describe("uuidV5", () => {
  it("matches the RFC 4122 reference value", () => {
    // Python: uuid.uuid5(uuid.NAMESPACE_DNS, "python.org")
    expect(uuidV5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "886313e1-3b8a-5372-9b90-0c9aee199e5d",
    );
  });

  it("is stable for the same name and differs for another", () => {
    const ns = "b92b0110-2258-4151-8c35-73de08de03ca";
    expect(uuidV5("a", ns)).toBe(uuidV5("a", ns));
    expect(uuidV5("a", ns)).not.toBe(uuidV5("b", ns));
  });
});
```

`packages/importers/src/oquants/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseOquantsDate, zonedTimeToEpoch } from "./time.js";

describe("parseOquantsDate", () => {
  it("reads oQuants' date text, ignoring the holding-days suffix", () => {
    expect(parseOquantsDate("Sep 10, 8:44 PM\n(1d)")).toEqual({ month: 9, day: 10, hour: 20, minute: 44 });
  });

  it("handles midnight and noon", () => {
    expect(parseOquantsDate("Sep 9, 12:05 AM")).toEqual({ month: 9, day: 9, hour: 0, minute: 5 });
    expect(parseOquantsDate("Sep 9, 12:30 PM")).toEqual({ month: 9, day: 9, hour: 12, minute: 30 });
  });

  it("returns null for anything else", () => {
    expect(parseOquantsDate("yesterday")).toBeNull();
    expect(parseOquantsDate("")).toBeNull();
  });
});

describe("zonedTimeToEpoch", () => {
  it("converts summer time in Athens (UTC+3)", () => {
    expect(zonedTimeToEpoch(2026, { month: 9, day: 9, hour: 20, minute: 54 }, "Europe/Athens")).toBe(
      Date.UTC(2026, 8, 9, 17, 54),
    );
  });

  it("converts winter time in New York (UTC-5)", () => {
    expect(zonedTimeToEpoch(2026, { month: 1, day: 5, hour: 9, minute: 30 }, "America/New_York")).toBe(
      Date.UTC(2026, 0, 5, 14, 30),
    );
  });
});
```

`packages/importers/src/oquants/payload.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { oquantsPayloadSchema } from "./payload.js";

const minimal = {
  format: "oquants-cells/1",
  capturedAt: "2026-09-23T15:00:00.000Z",
  timeZone: "Europe/Athens",
  pageCounter: "1–1 of 1",
  headers: ["Instrument"],
  trades: [],
};

describe("oquantsPayloadSchema", () => {
  it("accepts a well-formed payload", () => {
    expect(oquantsPayloadSchema.safeParse(minimal).success).toBe(true);
  });

  it("rejects another format", () => {
    expect(oquantsPayloadSchema.safeParse({ ...minimal, format: "something-else" }).success).toBe(false);
  });

  it("rejects an unknown time zone", () => {
    expect(oquantsPayloadSchema.safeParse({ ...minimal, timeZone: "Mars/Olympus" }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run packages/importers`
Expected: FAIL — modules `./ids.js`, `./time.js`, `./payload.js` not found.

- [ ] **Step 4: Implement**

`packages/importers/src/oquants/ids.ts`:

```ts
import { createHash } from "node:crypto";

/** Fixed namespace for oQuants trade ids; changing it would re-import everything as new. */
export const OQUANTS_NAMESPACE = "b92b0110-2258-4151-8c35-73de08de03ca";

/** RFC 4122 version 5 (SHA-1, name-based) UUID: the same name always gives the same id. */
export function uuidV5(name: string, namespace: string): string {
  const bytes = createHash("sha1")
    .update(Buffer.from(namespace.replace(/-/g, ""), "hex"))
    .update(name, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

`packages/importers/src/oquants/time.ts`:

```ts
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthDayTime {
  /** 1-12 */
  month: number;
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
}

/** oQuants shows "Sep 9, 8:54 PM", sometimes followed by "(1d)". It never shows the year. */
export function parseOquantsDate(text: string): MonthDayTime | null {
  const match = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{1,2}):(\d{2}) ?([AP]M)/.exec(text.replace(/\s+/g, " ").trim());
  if (!match) return null;
  const [, monthName, day, hour, minute, half] = match;
  const month = MONTHS.indexOf(monthName ?? "") + 1;
  const hour12 = Number(hour);
  if (month === 0 || hour12 < 1 || hour12 > 12) return null;
  return { month, day: Number(day), hour: (hour12 % 12) + (half === "PM" ? 12 : 0), minute: Number(minute) };
}

/** How far `timeZone`'s wall clock is ahead of UTC at `epochMs`. */
function offsetMs(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(epochMs);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return wall - Math.floor(epochMs / 60_000) * 60_000;
}

/** A wall-clock time in `timeZone` as epoch ms. The second pass settles times near a DST switch. */
export function zonedTimeToEpoch(year: number, time: MonthDayTime, timeZone: string): number {
  const wall = Date.UTC(year, time.month - 1, time.day, time.hour, time.minute);
  const firstGuess = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(firstGuess, timeZone);
}
```

`packages/importers/src/oquants/payload.ts`:

```ts
import { z } from "zod";

export const OQUANTS_FORMAT = "oquants-cells/1";

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const cells = z.array(z.string());

/** What scripts/oquants-extract.js copies: raw cell text, interpreted only by the parser. */
export const oquantsPayloadSchema = z.object({
  format: z.literal(OQUANTS_FORMAT),
  capturedAt: z.string(),
  timeZone: z.string().refine(isTimeZone, "unknown time zone"),
  pageCounter: z.string(),
  headers: cells,
  trades: z.array(
    z.object({
      ticker: z.string(),
      cells,
      designerHref: z.string(),
      legs: z.array(z.object({ cells })),
    }),
  ),
});

export type OquantsPayload = z.infer<typeof oquantsPayloadSchema>;
export type OquantsTradeCells = OquantsPayload["trades"][number];

/** A column the parser needs is gone: oQuants changed its table and nothing can be read safely. */
export class OquantsFormatError extends Error {}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/importers`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/importers tsconfig.json pnpm-lock.yaml
git commit -m "feat(importers): scaffold the package with the oQuants payload schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Parse oQuants trades

**Files:**
- Create: `packages/importers/src/oquants/parse.ts`
- Create: `packages/importers/src/oquants/fixture.ts` (synthetic payload builder, also used by server tests)
- Modify: `packages/importers/src/index.ts`
- Test: `packages/importers/src/oquants/parse.test.ts`

**Interfaces:**
- Consumes: Task 3's `OquantsPayload`, `OquantsTradeCells`, `OquantsFormatError`, `uuidV5`, `OQUANTS_NAMESPACE`, `parseOquantsDate`, `zonedTimeToEpoch`; core's `newTradeSchema`, `NewTrade`, `LegInput`, `round2`, `sumMoney`.
- Produces:
  ```ts
  export interface ParsedTrade { kind: "trade"; id: string; trade: NewTrade; flags: string[] }
  export interface SkippedRow { kind: "skip"; ticker: string; structure: string; reason: string }
  export type OquantsRow = ParsedTrade | SkippedRow;
  export interface OquantsParseResult { rows: OquantsRow[]; warnings: string[] }
  export function parseOquants(payload: OquantsPayload): OquantsParseResult; // throws OquantsFormatError
  ```
  From `@tj/importers/testing`: `OQUANTS_HEADERS`, `interface FixtureLeg`, `FLY_LEGS`, `fixtureTrade(options?)`, `fixturePayload(trades?, extra?)`.

- [ ] **Step 1: Write the fixture builder**

`packages/importers/src/oquants/fixture.ts`:

```ts
import type { OquantsPayload, OquantsTradeCells } from "./payload.js";

/**
 * Synthetic oQuants payloads, shaped like the real table. Real captures hold
 * the user's trades and never enter the repo.
 */
export const OQUANTS_HEADERS = [
  "Instrument", "Strategy", "Structure", "Notes", "Open Date", "Close Date",
  "Type", "Expiry", "Strike", "Size", "Cost", "P&L", "P&L %", "Actions",
];

export interface FixtureLeg {
  type: "Call" | "Put";
  strike: number;
  /** Signed: negative is short. */
  size: number;
  cost: string;
  pnl: string;
}

/** Short 50 straddle, wings 45 / 58, 4 lots: $1,200 credit, +$520 before $8 of fees. */
export const FLY_LEGS: FixtureLeg[] = [
  { type: "Call", strike: 50, size: -4, cost: "-840.00", pnl: "+440.00" },
  { type: "Put", strike: 50, size: -4, cost: "-640.00", pnl: "+320.00" },
  { type: "Call", strike: 58, size: 4, cost: "+140.00", pnl: "-120.00" },
  { type: "Put", strike: 45, size: 4, cost: "+140.00", pnl: "-120.00" },
];

export interface FixtureTradeOptions {
  ticker?: string;
  strategy?: string;
  structure?: string;
  notes?: string;
  open?: string;
  close?: string;
  cost?: string;
  pnl?: string;
  expiry?: string;
  legs?: FixtureLeg[];
}

export function fixtureTrade(options: FixtureTradeOptions = {}): OquantsTradeCells {
  const ticker = options.ticker ?? "XYZ";
  const legs = options.legs ?? FLY_LEGS;
  const params = new URLSearchParams();
  legs.forEach((leg, index) => {
    params.set(`positions[${index}][buySell]`, leg.size < 0 ? "S" : "B");
    params.set(`positions[${index}][size]`, String(Math.abs(leg.size)));
    params.set(`positions[${index}][type]`, leg.type);
    params.set(`positions[${index}][strike]`, String(leg.strike));
    params.set(`positions[${index}][expiration]`, options.expiry ?? "2026-09-11");
  });
  const row: Record<string, string> = {
    Instrument: `${ticker}\n48.10\nExample Corp`,
    Strategy: options.strategy ?? "Earnings",
    Structure: options.structure ?? "Short Iron Butterfly",
    Notes: options.notes ?? "filled at mid",
    "Open Date": options.open ?? "Sep 9, 8:54 PM",
    "Close Date": options.close ?? "Sep 10, 8:44 PM\n(1d)",
    Cost: options.cost ?? "-1,192.00",
    "P&L": options.pnl ?? "+512.00",
    "P&L %": "+42.95%",
  };
  return {
    ticker,
    cells: OQUANTS_HEADERS.map((header) => row[header] ?? ""),
    designerHref: `/dashboard/designer/${ticker}?${params}`,
    legs: legs.map((leg) => {
      const legRow: Record<string, string> = {
        Type: leg.type,
        Expiry: "Sep 11\n(2d)",
        Strike: leg.strike.toFixed(2),
        Size: leg.size > 0 ? `+${leg.size}` : String(leg.size),
        Cost: leg.cost,
        "P&L": leg.pnl,
      };
      return { cells: OQUANTS_HEADERS.map((header) => legRow[header] ?? "") };
    }),
  };
}

export function fixturePayload(
  trades: OquantsTradeCells[] = [fixtureTrade()],
  extra: Partial<OquantsPayload> = {},
): OquantsPayload {
  return {
    format: "oquants-cells/1",
    capturedAt: "2026-09-23T15:00:00.000Z",
    timeZone: "Europe/Athens",
    pageCounter: `1–${trades.length} of ${trades.length}`,
    headers: OQUANTS_HEADERS,
    trades,
    ...extra,
  };
}
```

(Biome will reformat the header array one-per-line on `pnpm format`; either layout is fine.)

- [ ] **Step 2: Write the failing tests**

`packages/importers/src/oquants/parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FLY_LEGS, fixturePayload, fixtureTrade, OQUANTS_HEADERS } from "./fixture.js";
import { type ParsedTrade, parseOquants, type SkippedRow } from "./parse.js";
import { OquantsFormatError } from "./payload.js";

const [shortCall, shortPut, longCall, longPut] = FLY_LEGS as [
  (typeof FLY_LEGS)[number],
  (typeof FLY_LEGS)[number],
  (typeof FLY_LEGS)[number],
  (typeof FLY_LEGS)[number],
];

function only(payload = fixturePayload()) {
  const { rows } = parseOquants(payload);
  expect(rows).toHaveLength(1);
  return rows[0] as ParsedTrade | SkippedRow;
}

function parsed(...args: Parameters<typeof fixtureTrade>): ParsedTrade {
  const row = only(fixturePayload([fixtureTrade(...args)]));
  if (row.kind !== "trade") throw new Error(`skipped: ${row.reason}`);
  return row;
}

function skipReason(...args: Parameters<typeof fixtureTrade>): string {
  const row = only(fixturePayload([fixtureTrade(...args)]));
  if (row.kind !== "skip") throw new Error("expected a skip");
  return row.reason;
}

describe("parseOquants", () => {
  it("parses a closed butterfly", () => {
    const { trade, flags } = parsed();
    expect(flags).toEqual([]);
    expect(trade).toMatchObject({
      strategy: "iron_fly",
      book: "paper",
      source: "oquants_extract",
      underlying: "XYZ",
      underlyingName: "Example Corp",
      structureLabel: "Short Iron Butterfly",
      openedAt: Date.UTC(2026, 8, 9, 17, 54),
      closedAt: Date.UTC(2026, 8, 10, 17, 44),
      netPnl: 512,
      fees: 8,
      feesOpen: null,
      feesClose: null,
      notes: null,
    });
    expect(trade.ironFly).toMatchObject({
      bodyPutStrike: 50,
      bodyCallStrike: 50,
      putWingStrike: 45,
      callWingStrike: 58,
      contracts: 4,
      creditPerShare: 3,
      netCost: -1192,
      sourceNotes: "filled at mid",
    });
    const call = trade.legs.find((leg) => leg.right === "C" && leg.quantity < 0);
    expect(call).toMatchObject({ strike: 50, expiry: "2026-09-11", openPrice: 2.1, closePrice: 1 });
    const put = trade.legs.find((leg) => leg.right === "P" && leg.quantity > 0);
    expect(put).toMatchObject({ strike: 45, openPrice: 0.35, closePrice: 0.05 });
  });

  it("parses a condor with separate body strikes", () => {
    const { trade } = parsed({
      structure: "Short Iron Condor",
      legs: [{ ...shortCall, strike: 52 }, { ...shortPut, strike: 48 }, longCall, longPut],
    });
    expect(trade.ironFly).toMatchObject({ bodyPutStrike: 48, bodyCallStrike: 52 });
  });

  it("imports a trade with no long put as 1 wing, put wing at 0", () => {
    const { trade, flags } = parsed({
      structure: "Short Straddle",
      legs: [shortCall, shortPut, longCall],
      cost: "-1,332.00",
      pnl: "+632.00",
    });
    expect(flags).toEqual(["1 wing"]);
    expect(trade.legs).toHaveLength(3);
    expect(trade.ironFly?.putWingStrike).toBe(0);
    expect(trade.fees).toBe(8);
    expect(trade.structureLabel).toBe("Short Straddle");
  });

  it("imports an open trade with no exit data, under the same id it has once closed", () => {
    const open = parsed({ close: "", pnl: "" });
    expect(open.trade.closedAt).toBeNull();
    expect(open.trade.netPnl).toBeNull();
    expect(open.trade.legs.every((leg) => leg.closePrice === null)).toBe(true);
    expect(open.id).toBe(parsed().id);
  });

  it("gives different trades different ids", () => {
    expect(parsed({ ticker: "ABC" }).id).not.toBe(parsed().id);
  });

  it("rolls the year back for a December open that expires in January", () => {
    const { trade } = parsed({ open: "Dec 30, 9:00 PM", close: "Jan 2, 4:00 PM\n(3d)", expiry: "2027-01-02" });
    expect(trade.openedAt).toBe(Date.UTC(2026, 11, 30, 19, 0));
    expect(trade.closedAt).toBe(Date.UTC(2027, 0, 2, 14, 0));
    expect(trade.legs[0]?.expiry).toBe("2027-01-02");
  });

  it("flags a row whose leg P&L does not add up to the row's", () => {
    const { flags, trade } = parsed({ pnl: "+500.00" });
    expect(trade.netPnl).toBe(500);
    expect(flags).toEqual(["doesn't reconcile ($12.00)"]);
  });

  it("skips other strategies", () => {
    expect(skipReason({ strategy: "VRP" })).toBe("strategy VRP");
  });

  it("skips a trade with no call wing", () => {
    expect(skipReason({ legs: [shortCall, shortPut, longPut] })).toBe(
      "no call wing — unlimited risk, enter manually",
    );
  });

  it("skips legs of unequal size", () => {
    expect(skipReason({ legs: [shortCall, shortPut, longCall, { ...longPut, size: 2 }] })).toBe(
      "unrecognized structure",
    );
  });

  it("skips an unparseable date", () => {
    expect(skipReason({ open: "yesterday" })).toBe('unparseable date "yesterday"');
  });

  it("skips negative fees", () => {
    expect(skipReason({ cost: "-1,210.00" })).toBe("fees came out negative ($-10.00)");
  });

  it("skips the second copy of a trade collected twice", () => {
    const { rows } = parseOquants(fixturePayload([fixtureTrade(), fixtureTrade()]));
    expect(rows.map((row) => row.kind)).toEqual(["trade", "skip"]);
    expect((rows[1] as SkippedRow).reason).toBe("duplicate row");
  });

  it("warns when the page counter disagrees with what was collected", () => {
    const { warnings } = parseOquants(fixturePayload([fixtureTrade()], { pageCounter: "1–50 of 72" }));
    expect(warnings).toEqual(["Collected 1 trades, the page counter said 72. Some rows may be missing."]);
  });

  it("refuses a table that lost a column it needs", () => {
    const headers = OQUANTS_HEADERS.map((header) => (header === "Cost" ? "Price" : header));
    expect(() => parseOquants(fixturePayload([fixtureTrade()], { headers }))).toThrow(OquantsFormatError);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run packages/importers/src/oquants/parse.test.ts`
Expected: FAIL — `./parse.js` not found.

- [ ] **Step 4: Implement the parser**

`packages/importers/src/oquants/parse.ts`:

```ts
import { type LegInput, type NewTrade, newTradeSchema, round2, sumMoney } from "@tj/core";
import { OQUANTS_NAMESPACE, uuidV5 } from "./ids.js";
import { type OquantsPayload, OquantsFormatError, type OquantsTradeCells } from "./payload.js";
import { type MonthDayTime, parseOquantsDate, zonedTimeToEpoch } from "./time.js";

const REQUIRED = [
  "Instrument",
  "Strategy",
  "Structure",
  "Notes",
  "Open Date",
  "Close Date",
  "Type",
  "Strike",
  "Size",
  "Cost",
  "P&L",
] as const;
type Column = (typeof REQUIRED)[number];
type CellReader = (cells: string[], column: Column) => string;

export interface ParsedTrade {
  kind: "trade";
  id: string;
  trade: NewTrade;
  flags: string[];
}

export interface SkippedRow {
  kind: "skip";
  ticker: string;
  structure: string;
  reason: string;
}

export type OquantsRow = ParsedTrade | SkippedRow;

export interface OquantsParseResult {
  rows: OquantsRow[];
  warnings: string[];
}

/** One trade can't be imported; caught per row so it never sinks the rest. */
class Skip extends Error {}

interface RawLeg {
  right: "C" | "P";
  strike: number;
  /** Signed: negative is short. */
  quantity: number;
  expiry: string;
  cost: number;
  /** Null when oQuants shows no P&L for the leg. */
  pnl: number | null;
}

interface Structure {
  bodyPutStrike: number;
  bodyCallStrike: number;
  putWingStrike: number;
  callWingStrike: number;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function money(text: string): number {
  const cleaned = text.replace(/[\s,$+]/g, "");
  const value = Number(cleaned);
  if (cleaned === "" || Number.isNaN(value)) throw new Skip(`unparseable number "${text}"`);
  return value;
}

/** The designer link is the only place oQuants gives each leg's full ISO expiry. */
function linkLegs(href: string): { right: "C" | "P"; strike: number; expiry: string }[] {
  const params = new URL(href, "https://oquants.invalid").searchParams;
  const legs: { right: "C" | "P"; strike: number; expiry: string }[] = [];
  for (let index = 0; params.has(`positions[${index}][type]`); index++) {
    const expiry = params.get(`positions[${index}][expiration]`) ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) continue;
    legs.push({
      right: params.get(`positions[${index}][type]`) === "Call" ? "C" : "P",
      strike: Number(params.get(`positions[${index}][strike]`)),
      expiry,
    });
  }
  return legs;
}

function readLegs(raw: OquantsTradeCells, cell: CellReader): RawLeg[] {
  const fromLink = linkLegs(raw.designerHref);
  return raw.legs.map((leg) => {
    const type = cell(leg.cells, "Type");
    if (type !== "Call" && type !== "Put") throw new Skip("unrecognized structure");
    const right = type === "Call" ? "C" : "P";
    const strike = money(cell(leg.cells, "Strike"));
    const quantity = money(cell(leg.cells, "Size"));
    if (!Number.isInteger(quantity) || quantity === 0) throw new Skip("unrecognized structure");
    const expiry = fromLink.find((link) => link.right === right && Math.abs(link.strike - strike) < 1e-6)?.expiry;
    if (!expiry) throw new Skip(`leg ${type} ${strike} is missing from the designer link`);
    const pnlText = cell(leg.cells, "P&L");
    return {
      right,
      strike,
      quantity,
      expiry,
      cost: money(cell(leg.cells, "Cost")),
      pnl: pnlText === "" ? null : money(pnlText),
    };
  });
}

/** A short put and call body, a long call above, and optionally a long put below. */
function classify(legs: RawLeg[]): Structure {
  const pick = (right: "C" | "P", short: boolean) =>
    legs.filter((leg) => leg.right === right && leg.quantity < 0 === short);
  const shortCalls = pick("C", true);
  const shortPuts = pick("P", true);
  const longCalls = pick("C", false);
  const longPuts = pick("P", false);
  if (shortCalls.length === 1 && shortPuts.length === 1 && longCalls.length === 0 && longPuts.length <= 1) {
    throw new Skip("no call wing — unlimited risk, enter manually");
  }
  const [shortCall] = shortCalls;
  const [shortPut] = shortPuts;
  const [longCall] = longCalls;
  const [longPut] = longPuts;
  if (!shortCall || !shortPut || !longCall || shortCalls.length > 1 || shortPuts.length > 1) {
    throw new Skip("unrecognized structure");
  }
  if (longCalls.length > 1 || longPuts.length > 1) throw new Skip("unrecognized structure");
  const size = Math.abs(shortCall.quantity);
  if (legs.some((leg) => Math.abs(leg.quantity) !== size)) throw new Skip("unrecognized structure");
  if (
    longCall.strike <= shortCall.strike ||
    shortPut.strike > shortCall.strike ||
    (longPut && longPut.strike >= shortPut.strike)
  ) {
    throw new Skip("unrecognized structure");
  }
  return {
    bodyPutStrike: shortPut.strike,
    bodyCallStrike: shortCall.strike,
    putWingStrike: longPut?.strike ?? 0,
    callWingStrike: longCall.strike,
  };
}

const dayNumber = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day);

/** oQuants dates carry no year: take the expiry's, stepping back if the open would land after expiry. */
function datesFor(open: MonthDayTime, close: MonthDayTime | null, expiry: string, timeZone: string) {
  const expiryYear = Number(expiry.slice(0, 4));
  const expiryDay = dayNumber(expiryYear, Number(expiry.slice(5, 7)), Number(expiry.slice(8, 10)));
  const openYear = dayNumber(expiryYear, open.month, open.day) > expiryDay ? expiryYear - 1 : expiryYear;
  const openedAt = zonedTimeToEpoch(openYear, open, timeZone);
  if (!close) return { openedAt, closedAt: null };
  const closeYear =
    dayNumber(openYear, close.month, close.day) < dayNumber(openYear, open.month, open.day) ? openYear + 1 : openYear;
  return { openedAt, closedAt: zonedTimeToEpoch(closeYear, close, timeZone) };
}

function readDate(text: string): MonthDayTime {
  const date = parseOquantsDate(text);
  if (!date) throw new Skip(`unparseable date "${text}"`);
  return date;
}

/** "M\n22.68\nMacy's Inc": the company name is the line that is neither the ticker nor a price. */
function companyName(instrument: string, ticker: string): string | null {
  const lines = instrument
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && line !== ticker && !/^[\d.,]+$/.test(line) && !line.startsWith(`${ticker} `));
  return lines.at(-1) ?? null;
}

function parseTrade(raw: OquantsTradeCells, cell: CellReader, timeZone: string): ParsedTrade {
  const strategy = cell(raw.cells, "Strategy");
  if (strategy !== "Earnings") throw new Skip(`strategy ${strategy || "(none)"}`);

  const legs = readLegs(raw, cell);
  const structure = classify(legs);
  const flags = structure.putWingStrike === 0 ? ["1 wing"] : [];

  const open = readDate(cell(raw.cells, "Open Date"));
  const closeText = cell(raw.cells, "Close Date");
  const close = closeText === "" ? null : readDate(closeText);
  const { openedAt, closedAt } = datesFor(open, close, legs[0]?.expiry ?? "", timeZone);

  const rowCost = money(cell(raw.cells, "Cost"));
  const legCost = sumMoney(legs.map((leg) => leg.cost));
  // Round-trip fees make the row's credit smaller than the legs' total.
  const fees = round2(rowCost - legCost);
  if (fees < 0) throw new Skip(`fees came out negative ($${fees.toFixed(2)})`);

  const closed = closedAt !== null;
  let netPnl: number | null = null;
  if (closed) {
    if (legs.some((leg) => leg.pnl === null)) throw new Skip("missing leg P&L");
    netPnl = money(cell(raw.cells, "P&L"));
    const gap = round2(sumMoney(legs.map((leg) => leg.pnl ?? 0)) - netPnl - fees);
    if (Math.abs(gap) > 0.01) flags.push(`doesn't reconcile ($${gap.toFixed(2)})`);
  }

  const contracts = Math.abs(legs[0]?.quantity ?? 0);
  const perShare = (dollars: number, quantity: number) => round4(Math.abs(dollars) / (Math.abs(quantity) * 100));
  const legInputs: LegInput[] = legs.map((leg) => ({
    right: leg.right,
    strike: leg.strike,
    expiry: leg.expiry,
    quantity: leg.quantity,
    multiplier: 100,
    openPrice: perShare(leg.cost, leg.quantity),
    closePrice: closed ? perShare(leg.cost + (leg.pnl ?? 0), leg.quantity) : null,
  }));

  const ticker = (raw.ticker || cell(raw.cells, "Instrument").split("\n")[0] || "").trim();
  const result = newTradeSchema.safeParse({
    strategy: "iron_fly",
    book: "paper",
    source: "oquants_extract",
    underlying: ticker,
    underlyingName: companyName(cell(raw.cells, "Instrument"), ticker),
    structureLabel: cell(raw.cells, "Structure").slice(0, 60) || null,
    openedAt,
    closedAt,
    netPnl,
    fees,
    feesOpen: null,
    feesClose: null,
    legs: legInputs,
    ironFly: {
      ...structure,
      contracts,
      creditPerShare: round4(-legCost / (contracts * 100)),
      netCost: rowCost,
      sourceNotes: cell(raw.cells, "Notes") || null,
    },
  });
  if (!result.success) throw new Skip(`invalid trade: ${result.error.issues[0]?.message ?? "unknown"}`);

  // Close time is left out so an open trade keeps its id once it closes.
  const legKey = [...legInputs]
    .sort((a, b) => a.right.localeCompare(b.right) || a.strike - b.strike || a.quantity - b.quantity)
    .map((leg) => `${leg.right}${leg.strike}x${leg.quantity}`)
    .join(",");
  const key = `${ticker.toUpperCase()}|${Math.floor(openedAt / 60_000)}|${legKey}`;
  return { kind: "trade", id: uuidV5(key, OQUANTS_NAMESPACE), trade: result.data, flags };
}

function counterWarnings(payload: OquantsPayload): string[] {
  const total = /of\s+(\d+)/.exec(payload.pageCounter)?.[1];
  if (total === undefined || Number(total) === payload.trades.length) return [];
  return [`Collected ${payload.trades.length} trades, the page counter said ${total}. Some rows may be missing.`];
}

export function parseOquants(payload: OquantsPayload): OquantsParseResult {
  const columns = {} as Record<Column, number>;
  for (const name of REQUIRED) {
    const index = payload.headers.indexOf(name);
    if (index === -1) {
      throw new OquantsFormatError(
        `oQuants changed its table: the "${name}" column is missing, so the parser needs updating`,
      );
    }
    columns[name] = index;
  }
  const cell: CellReader = (cells, column) => (cells[columns[column]] ?? "").trim();

  const rows: OquantsRow[] = [];
  const seen = new Set<string>();
  for (const raw of payload.trades) {
    try {
      const row = parseTrade(raw, cell, payload.timeZone);
      if (seen.has(row.id)) throw new Skip("duplicate row");
      seen.add(row.id);
      rows.push(row);
    } catch (error) {
      if (!(error instanceof Skip)) throw error;
      rows.push({ kind: "skip", ticker: raw.ticker, structure: cell(raw.cells, "Structure"), reason: error.message });
    }
  }
  return { rows, warnings: counterWarnings(payload) };
}
```

Add to `packages/importers/src/index.ts`:

```ts
export * from "./oquants/parse.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/importers`
Expected: PASS. If the reconciliation test's gap sign disagrees, the formula is: gap = Σ leg P&L − row P&L − fees = 520 − 500 − 8 = 12.

- [ ] **Step 6: Commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/importers
git commit -m "feat(importers): parse oQuants earnings trades into iron flies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Backups and bulk insert in the database layer

**Files:**
- Create: `packages/db/src/backup.ts`
- Modify: `packages/db/src/migrate.ts` (use `backupDatabase`, drop its own copy and prune)
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/repositories/trades.ts` (extract `insertTrade`, add `existingIds` and `importMany`)
- Test: `packages/db/src/backup.test.ts`, `packages/db/src/repositories/trades.test.ts`

**Interfaces:**
- Produces:
  - `backupDatabase(dbFile: string, backupDir: string, keep?: number): string` — returns the backup's path.
  - Trades repo: `existingIds(ids: string[]): Set<string>` (includes soft-deleted), `importMany(items: { id: string; trade: NewTrade }[], importBatchId: string): number` (one transaction, returns count inserted).

- [ ] **Step 1: Write the failing tests**

`packages/db/src/backup.test.ts`:

```ts
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { backupDatabase } from "./backup.js";
import { openDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";
import { trades } from "./schema.js";

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

describe("backupDatabase", () => {
  it("copies a database the app still has open, including uncheckpointed writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "tj-backup-"));
    const file = join(dir, "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const db = openDatabase(file);
    db.insert(trades)
      .values({
        id: "t1",
        strategy: "iron_fly",
        book: "paper",
        underlying: "XYZ",
        openedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();

    const copy = backupDatabase(file, join(dir, "backups"));

    expect(openDatabase(copy).select().from(trades).all()).toHaveLength(1);
  });

  it("never overwrites a backup taken in the same millisecond", () => {
    const dir = mkdtempSync(join(tmpdir(), "tj-backup-"));
    const file = join(dir, "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const first = backupDatabase(file, join(dir, "backups"));
    const second = backupDatabase(file, join(dir, "backups"));
    expect(second).not.toBe(first);
  });

  it("keeps only the most recent backups", () => {
    const dir = mkdtempSync(join(tmpdir(), "tj-backup-"));
    const file = join(dir, "journal.db");
    const backupDir = join(dir, "backups");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    backupDatabase(file, backupDir);
    for (let index = 0; index < 4; index++) writeFileSync(join(backupDir, `journal-old-${index}.db`), "x");
    backupDatabase(file, backupDir, 2);
    expect(readdirSync(backupDir).filter((name) => name.endsWith(".db"))).toHaveLength(2);
  });
});
```

If the `trades` insert above fails type-checking because a required column is missing, add that column with a plain value; check `packages/db/src/schema.ts` (`syncColumns`) for the exact names.

In `packages/db/src/repositories/trades.test.ts`, add a new `describe` block at the end of the file (reuse the file's existing `sampleFly`, `MIGRATIONS`, imports and temp-db pattern; if the file has a `beforeEach` that creates `repo` and `db`, put this block inside the same outer `describe` so it shares them):

```ts
describe("importing", () => {
  let repo: ReturnType<typeof createTradesRepo>;

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-import-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    repo = createTradesRepo(openDatabase(file), () => 1_790_000_000_000);
  });

  const imported: NewTrade = { ...sampleFly, source: "oquants_extract", book: "paper" };
  const ID_A = "0b0e0a2e-5b1c-5d8f-9a53-8a0f0f0f0f01";
  const ID_B = "0b0e0a2e-5b1c-5d8f-9a53-8a0f0f0f0f02";

  it("inserts under the given ids, tagged with the batch and not marked as user-edited", () => {
    expect(repo.importMany([{ id: ID_A, trade: imported }], "batch-1")).toBe(1);
    const stored = repo.get(ID_A);
    expect(stored?.importBatchId).toBe("batch-1");
    expect(stored?.source).toBe("oquants_extract");
    expect(stored?.editedAt).toBeNull();
    expect(stored?.legs).toHaveLength(4);
    expect(stored?.ironFly?.putWingStrike).toBe(45);
  });

  it("reports which ids exist, soft-deleted ones included", () => {
    repo.importMany([{ id: ID_A, trade: imported }], "batch-1");
    repo.softDelete(ID_A);
    expect(repo.existingIds([ID_A, ID_B])).toEqual(new Set([ID_A]));
  });

  it("writes nothing when any trade in the batch fails", () => {
    expect(() =>
      repo.importMany(
        [
          { id: ID_A, trade: imported },
          { id: ID_A, trade: imported },
        ],
        "batch-1",
      ),
    ).toThrow();
    expect(repo.existingIds([ID_A]).size).toBe(0);
  });
});
```

The file already imports `beforeEach`, `mkdtempSync`, `tmpdir`, `join`, `openDatabase` and `runMigrations`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/db`
Expected: FAIL — `./backup.js` not found; `repo.importMany` / `repo.existingIds` are not functions.

- [ ] **Step 3: Implement the backup**

`packages/db/src/backup.ts`:

```ts
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

/**
 * Snapshot the database with VACUUM INTO on its own read-only connection. Unlike
 * copying the file, this is consistent while the app holds it open in WAL mode.
 */
export function backupDatabase(dbFile: string, backupDir: string, keep = 10): string {
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let target = join(backupDir, `journal-${stamp}.db`);
  for (let suffix = 1; existsSync(target); suffix++) target = join(backupDir, `journal-${stamp}-${suffix}.db`);

  const source = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    source.prepare("VACUUM INTO ?").run(target);
  } finally {
    source.close();
  }
  pruneBackups(backupDir, keep);
  return target;
}

function pruneBackups(backupDir: string, keep: number): void {
  const files = readdirSync(backupDir)
    .filter((name) => name.endsWith(".db"))
    .map((name) => ({ name, mtime: statSync(join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const file of files.slice(keep)) unlinkSync(join(backupDir, file.name));
}
```

Replace `packages/db/src/migrate.ts` with:

```ts
import { existsSync } from "node:fs";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { backupDatabase } from "./backup.js";
import { openDatabase } from "./client.js";

export interface MigrateOptions {
  migrationsFolder: string;
  backupDir?: string;
  keepBackups?: number;
}

/** Snapshot the database, prune old snapshots, then apply pending migrations. */
export function runMigrations(filePath: string, options: MigrateOptions): void {
  const { migrationsFolder, backupDir, keepBackups = 10 } = options;
  if (backupDir && existsSync(filePath)) backupDatabase(filePath, backupDir, keepBackups);
  const db = openDatabase(filePath);
  migrate(db, { migrationsFolder });
}
```

Add to `packages/db/src/index.ts`:

```ts
export * from "./backup.js";
```

- [ ] **Step 4: Implement the repository methods**

In `packages/db/src/repositories/trades.ts`, add `inArray` to the drizzle import:

```ts
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
```

Inside `createTradesRepo`, after `writeChildren`, add an `insertTrade` helper holding the insert that `create` does today:

```ts
  function insertTrade(conn: DbLike, id: string, input: NewTrade, timestamp: number, importBatchId: string | null) {
    conn
      .insert(trades)
      .values({
        id,
        strategy: input.strategy,
        book: input.book,
        accountId: null,
        underlying: input.underlying,
        underlyingName: input.underlyingName,
        structureLabel: input.structureLabel,
        openedAt: input.openedAt,
        closedAt: input.closedAt,
        netPnl: input.netPnl,
        fees: input.fees,
        feesOpen: input.feesOpen,
        feesClose: input.feesClose,
        notes: input.notes,
        grade: input.grade,
        setupId: input.setupId,
        excluded: input.excluded,
        excludeReason: input.excludeReason,
        source: input.source,
        externalRef: null,
        importBatchId,
        // Typing a trade in by hand is a user edit; an import is not.
        editedAt: input.source === "manual" ? timestamp : null,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      })
      .run();
    writeChildren(conn, id, input, timestamp);
  }
```

Replace `create` with:

```ts
    create(input: NewTrade): TradeRecord {
      const timestamp = now();
      const id = crypto.randomUUID();
      return db.transaction((tx) => {
        insertTrade(tx, id, input, timestamp, null);
        return requireRow(tx, id);
      });
    },
```

Add after `create`:

```ts
    /** Every id already stored, soft-deleted included, so a deleted import stays deleted. */
    existingIds(ids: string[]): Set<string> {
      if (ids.length === 0) return new Set();
      const rows = db.select({ id: trades.id }).from(trades).where(inArray(trades.id, ids)).all();
      return new Set(rows.map((row) => row.id));
    },

    /** All or nothing: one failing trade rolls back the whole batch. */
    importMany(items: { id: string; trade: NewTrade }[], importBatchId: string): number {
      const timestamp = now();
      db.transaction((tx) => {
        for (const item of items) insertTrade(tx, item.id, item.trade, timestamp, importBatchId);
      });
      return items.length;
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/db`
Expected: PASS, including the existing `migrate.test.ts` backup tests.

- [ ] **Step 6: Commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/db
git commit -m "feat(db): WAL-safe backups and all-or-nothing bulk import

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Import endpoints

**Files:**
- Create: `apps/server/src/routes/import.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/index.ts`
- Modify: `apps/server/package.json` (add `"@tj/importers": "workspace:*"`), `apps/server/tsconfig.json` (add reference `{ "path": "../../packages/importers" }`)
- Test: `apps/server/src/import.test.ts`

**Interfaces:**
- Consumes: `parseOquants`, `oquantsPayloadSchema`, `OquantsFormatError`, `ParsedTrade` from `@tj/importers`; `fixturePayload`, `fixtureTrade` from `@tj/importers/testing` (tests only); repo `existingIds`, `importMany`; `backupDatabase`.
- Produces (HTTP, typed through `AppType`):
  - `POST /api/import/oquants/preview` → `200 { warnings: string[]; counts: { new: number; existing: number; skipped: number }; rows: PreviewRow[] }` | `400` | `422 { error: string }`
  - `POST /api/import/oquants/commit` → `200 { imported: number; backupFile: string | null }` | `400` | `422 { error: string }`
  - `PreviewRow = { status: "new" | "existing" | "skipped"; ticker: string; structure: string; openedAt: number | null; closedAt: number | null; netPnl: number | null; flags: string[]; reason: string | null }`
  - `AppDeps.backup?: () => string`

- [ ] **Step 1: Wire the dependency**

Add `"@tj/importers": "workspace:*"` to `apps/server/package.json` dependencies and `{ "path": "../../packages/importers" }` to `apps/server/tsconfig.json` references.

Run: `pnpm install`
Expected: no errors.

- [ ] **Step 2: Write the failing tests**

`apps/server/src/import.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, runMigrations } from "@tj/db";
import { fixturePayload, fixtureTrade, OQUANTS_HEADERS } from "@tj/importers/testing";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createApp } from "./app.js";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));
const JSON_HEADERS = { "content-type": "application/json", host: "localhost" };

interface PreviewBody {
  warnings: string[];
  counts: { new: number; existing: number; skipped: number };
  rows: { status: string; ticker: string; reason: string | null; flags: string[] }[];
}

const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

describe("oQuants import", () => {
  let app: ReturnType<typeof createApp>;
  let backup: Mock<() => string>;

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-import-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    backup = vi.fn(() => "journal-backup.db");
    app = createApp({ db: openDatabase(file), backup });
  });

  const send = (step: "preview" | "commit", body: unknown) =>
    app.request(`/api/import/oquants/${step}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });

  const payload = fixturePayload([fixtureTrade(), fixtureTrade({ ticker: "SPY", strategy: "VRP" })]);

  it("previews new and skipped rows without writing", async () => {
    const res = await send("preview", payload);
    expect(res.status).toBe(200);
    const body = await readJson<PreviewBody>(res);
    expect(body.counts).toEqual({ new: 1, existing: 0, skipped: 1 });
    expect(body.rows.map((row) => [row.status, row.ticker, row.reason])).toEqual([
      ["new", "XYZ", null],
      ["skipped", "SPY", "strategy VRP"],
    ]);
    expect(backup).not.toHaveBeenCalled();
  });

  it("imports new trades into the paper book after a backup", async () => {
    const res = await send("commit", payload);
    expect(await readJson(res)).toEqual({ imported: 1, backupFile: "journal-backup.db" });
    expect(backup).toHaveBeenCalledOnce();

    const list = await readJson<{ underlying: string; book: string; source: string }[]>(
      await app.request("/api/trades", { headers: { host: "localhost" } }),
    );
    expect(list).toMatchObject([{ underlying: "XYZ", book: "paper", source: "oquants_extract" }]);
  });

  it("imports nothing, and takes no backup, when everything is already in", async () => {
    await send("commit", payload);
    backup.mockClear();

    const preview = await readJson<PreviewBody>(await send("preview", payload));
    expect(preview.counts).toEqual({ new: 0, existing: 1, skipped: 1 });
    expect(preview.rows[0]).toMatchObject({ status: "existing", reason: "already imported" });

    expect(await readJson(await send("commit", payload))).toEqual({ imported: 0, backupFile: null });
    expect(backup).not.toHaveBeenCalled();
  });

  it("rejects something that is not a snippet export", async () => {
    expect((await send("preview", { format: "nope" })).status).toBe(400);
  });

  it("explains when oQuants changed its table", async () => {
    const headers = OQUANTS_HEADERS.filter((header) => header !== "Cost");
    const res = await send("preview", fixturePayload([fixtureTrade()], { headers }));
    expect(res.status).toBe(422);
    expect((await readJson<{ error: string }>(res)).error).toContain('"Cost"');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run apps/server/src/import.test.ts`
Expected: FAIL — 404s (routes not mounted) and a type error on `backup` in `createApp`.

- [ ] **Step 4: Implement the routes**

`apps/server/src/routes/import.ts`:

```ts
import { zValidator } from "@hono/zod-validator";
import { createTradesRepo, type Db } from "@tj/db";
import {
  type OquantsPayload,
  OquantsFormatError,
  oquantsPayloadSchema,
  type ParsedTrade,
  parseOquants,
} from "@tj/importers";
import { Hono } from "hono";

export interface PreviewRow {
  status: "new" | "existing" | "skipped";
  ticker: string;
  structure: string;
  openedAt: number | null;
  closedAt: number | null;
  netPnl: number | null;
  flags: string[];
  reason: string | null;
}

const ORDER = { new: 0, existing: 1, skipped: 2 } as const;

/**
 * Insert-only: a trade already in the journal is never touched, so re-running
 * the import after more trades land in oQuants only adds the new ones.
 */
export function importRoutes(db: Db, backup?: () => string, now?: () => number) {
  const repo = createTradesRepo(db, now);

  function plan(payload: OquantsPayload) {
    const { rows, warnings } = parseOquants(payload);
    const parsed = rows.filter((row): row is ParsedTrade => row.kind === "trade");
    const existing = repo.existingIds(parsed.map((row) => row.id));
    const preview: PreviewRow[] = rows
      .map((row): PreviewRow => {
        if (row.kind === "skip") {
          return {
            status: "skipped",
            ticker: row.ticker,
            structure: row.structure,
            openedAt: null,
            closedAt: null,
            netPnl: null,
            flags: [],
            reason: row.reason,
          };
        }
        const already = existing.has(row.id);
        return {
          status: already ? "existing" : "new",
          ticker: row.trade.underlying,
          structure: row.trade.structureLabel ?? "",
          openedAt: row.trade.openedAt,
          closedAt: row.trade.closedAt,
          netPnl: row.trade.netPnl,
          flags: row.flags,
          reason: already ? "already imported" : null,
        };
      })
      .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    const counts = {
      new: preview.filter((row) => row.status === "new").length,
      existing: preview.filter((row) => row.status === "existing").length,
      skipped: preview.filter((row) => row.status === "skipped").length,
    };
    return { warnings, counts, preview, fresh: parsed.filter((row) => !existing.has(row.id)) };
  }

  return new Hono()
    .post("/oquants/preview", zValidator("json", oquantsPayloadSchema), (c) => {
      try {
        const { warnings, counts, preview } = plan(c.req.valid("json"));
        return c.json({ warnings, counts, rows: preview }, 200);
      } catch (error) {
        if (error instanceof OquantsFormatError) return c.json({ error: error.message }, 422);
        throw error;
      }
    })
    .post("/oquants/commit", zValidator("json", oquantsPayloadSchema), (c) => {
      try {
        // Planned again rather than trusting the preview, so a stale page cannot insert twice.
        const { fresh } = plan(c.req.valid("json"));
        if (fresh.length === 0) return c.json({ imported: 0, backupFile: null as string | null }, 200);
        const backupFile = backup ? backup() : null;
        const imported = repo.importMany(
          fresh.map((row) => ({ id: row.id, trade: row.trade })),
          crypto.randomUUID(),
        );
        return c.json({ imported, backupFile }, 200);
      } catch (error) {
        if (error instanceof OquantsFormatError) return c.json({ error: error.message }, 422);
        throw error;
      }
    });
}
```

In `apps/server/src/app.ts`:

- import: `import { importRoutes } from "./routes/import.js";`
- add to `AppDeps`:

```ts
  /** Snapshots the database before an import writes; returns the backup's path. */
  backup?: () => string;
```

- add `.route("/api/import", importRoutes(deps.db, deps.backup, deps.now))` to the chain after `.route("/api/tags", tags)`.

In `apps/server/src/index.ts`, import `backupDatabase` alongside `openDatabase, runMigrations` from `@tj/db`, and change the `createApp` call to:

```ts
const app = createApp({
  db: openDatabase(paths.dbFile),
  webDir,
  backup: () => backupDatabase(paths.dbFile, paths.backupDir),
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run apps/server`
Expected: PASS (new tests and existing app/static/config tests)

- [ ] **Step 6: Commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): preview and commit oQuants imports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Import page

**Files:**
- Create: `apps/web/src/routes/Import.tsx`
- Modify: `apps/web/src/router.tsx` (real `/import` route; remove the `/import` entry from `PLACEHOLDERS`)
- Test: `apps/web/src/routes/Import.test.tsx`

**Interfaces:**
- Consumes: Task 6's endpoints via `api.api.import.oquants.preview.$post` / `.commit.$post`.
- Produces: `Import({ onDone }: { onDone?: () => void })`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/routes/Import.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Import } from "./Import.js";

const preview = {
  warnings: ["Collected 2 trades, the page counter said 3. Some rows may be missing."],
  counts: { new: 1, existing: 0, skipped: 1 },
  rows: [
    {
      status: "new",
      ticker: "XYZ",
      structure: "Short Straddle",
      openedAt: 1_788_000_000_000,
      closedAt: 1_788_086_400_000,
      netPnl: 200,
      flags: ["1 wing"],
      reason: null,
    },
    {
      status: "skipped",
      ticker: "SPY",
      structure: "Short Iron Condor",
      openedAt: null,
      closedAt: null,
      netPnl: null,
      flags: [],
      reason: "strategy VRP",
    },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Import />
    </QueryClientProvider>,
  );
}

const paste = (text: string) => fireEvent.change(screen.getByLabelText("Snippet output"), { target: { value: text } });

afterEach(() => vi.unstubAllGlobals());

describe("Import", () => {
  it("previews the pasted export, then imports the new trades", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(preview))
      .mockResolvedValueOnce(json({ imported: 1, backupFile: "/data/backups/journal-x.db" }));
    vi.stubGlobal("fetch", fetchMock);
    setup();

    paste('{"format":"oquants-cells/1"}');
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(screen.getByText("strategy VRP")).toBeTruthy());
    expect(screen.getByText("1 wing")).toBeTruthy();
    expect(screen.getByText(/page counter said 3/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Import 1" }));
    await waitFor(() => expect(screen.getByText(/1 trade imported/)).toBeTruthy());
    expect(screen.getByText(/journal-x\.db/)).toBeTruthy();
  });

  it("says so, without calling the server, when the paste is not JSON", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setup();

    paste("Copied 12 trades");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByText(/isn't the snippet's output/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's reason when oQuants changed its table", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: 'the "Cost" column is missing' }, 422)));
    setup();

    paste('{"format":"oquants-cells/1"}');
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(screen.getByText(/"Cost" column is missing/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/web/src/routes/Import.test.tsx`
Expected: FAIL — `./Import.js` not found.

- [ ] **Step 3: Implement the page**

`apps/web/src/routes/Import.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api.js";
import { Money, Panel } from "../components/ui.js";

interface PreviewRow {
  status: "new" | "existing" | "skipped";
  ticker: string;
  structure: string;
  openedAt: number | null;
  closedAt: number | null;
  netPnl: number | null;
  flags: string[];
  reason: string | null;
}

interface Preview {
  warnings: string[];
  counts: { new: number; existing: number; skipped: number };
  rows: PreviewRow[];
}

interface CommitResult {
  imported: number;
  backupFile: string | null;
}

const NOT_AN_EXPORT = "That isn't the snippet's output. Run the snippet on oQuants again and paste what it copied.";

const when = (epochMs: number | null) =>
  epochMs == null
    ? "—"
    : new Date(epochMs).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

const STATUS_LABEL = { new: "NEW", existing: "HAVE", skipped: "SKIP" } as const;

async function send(step: "preview" | "commit", payload: unknown): Promise<unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: the server validates the pasted payload
  const json = payload as any;
  const res =
    step === "preview"
      ? await api.api.import.oquants.preview.$post({ json })
      : await api.api.import.oquants.commit.$post({ json });
  const body: unknown = await res.json();
  if (res.ok) return body;
  if (res.status === 400) throw new Error(NOT_AN_EXPORT);
  throw new Error((body as { error?: string }).error ?? `Import failed (${res.status}).`);
}

export function Import({ onDone }: { onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  const previewStep = useMutation({
    mutationFn: (payload: unknown) => send("preview", payload) as Promise<Preview>,
    onSuccess: (data) => {
      setPreview(data);
      setResult(null);
    },
    onError: (error) => setProblem(error.message),
  });

  const commitStep = useMutation({
    mutationFn: (payload: unknown) => send("commit", payload) as Promise<CommitResult>,
    onSuccess: (data) => {
      setResult(data);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["trades"] });
    },
    onError: (error) => setProblem(error.message),
  });

  function run(mutate: (payload: unknown) => void) {
    setProblem(null);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      setProblem(NOT_AN_EXPORT);
      return;
    }
    mutate(payload);
  }

  const busy = previewStep.isPending || commitStep.isPending;

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Import / Sync — oQuants">
        <p className="mb-2 text-muted">
          On oQuants → Portfolio, open DevTools (F12) → Console, paste <code>scripts/oquants-extract.js</code> and
          press Enter. It copies the table; paste it here.
        </p>
        <textarea
          aria-label="Snippet output"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="num min-h-24 w-full rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[12px] text-fg outline-none focus:border-accent"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => run(previewStep.mutate)}
            disabled={busy}
            className="rounded-sm border border-line px-3 py-1.5 text-fg disabled:opacity-50"
          >
            Preview
          </button>
          {preview && (
            <button
              type="button"
              onClick={() => run(commitStep.mutate)}
              disabled={busy || preview.counts.new === 0}
              className="rounded-sm bg-accent px-3 py-1.5 text-white disabled:opacity-50"
            >
              Import {preview.counts.new}
            </button>
          )}
        </div>
        {problem && <p className="mt-2 text-down">{problem}</p>}
        {result && (
          <p className="mt-2 text-up">
            {result.imported} trade{result.imported === 1 ? "" : "s"} imported
            {result.backupFile ? ` · backup saved as ${result.backupFile}` : ""}
            {onDone && (
              <button type="button" onClick={onDone} className="ml-2 text-accent underline">
                Open Iron Flies
              </button>
            )}
          </p>
        )}
      </Panel>

      {preview && (
        <Panel title="Preview">
          {preview.warnings.map((warning) => (
            <p key={warning} className="mb-1 text-down">
              ⚠ {warning}
            </p>
          ))}
          <p className="mb-2 text-muted">
            NEW {preview.counts.new} · ALREADY IMPORTED {preview.counts.existing} · SKIPPED {preview.counts.skipped}
          </p>
          <table className="w-full border-collapse text-[11px]">
            <thead className="text-[9px] text-muted uppercase tracking-wider">
              <tr>
                <th className="py-1 text-left font-medium" />
                <th className="text-left font-medium">Ticker</th>
                <th className="text-left font-medium">Structure</th>
                <th className="text-left font-medium">Opened (ET)</th>
                <th className="text-left font-medium">Closed (ET)</th>
                <th className="text-right font-medium">Net P&amp;L</th>
                <th className="pl-3 text-left font-medium">Flags / reason</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, index) => (
                // Rows have no id of their own; the list never reorders while shown.
                // biome-ignore lint/suspicious/noArrayIndexKey: static list
                <tr key={index} className="border-line border-t">
                  <td className="py-1 text-muted">{STATUS_LABEL[row.status]}</td>
                  <td>{row.ticker}</td>
                  <td>{row.structure}</td>
                  <td className="num">{when(row.openedAt)}</td>
                  <td className="num">{when(row.closedAt)}</td>
                  <td className="text-right">
                    <Money value={row.netPnl} />
                  </td>
                  <td className="pl-3 text-muted">{[...row.flags, row.reason].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
```

The flags cell joins flags and reason with ` · `; the test's `getByText("1 wing")` matches because the "new" row has no reason.

- [ ] **Step 4: Wire the route**

In `apps/web/src/router.tsx`:

- `import { Import } from "./routes/Import.js";`
- remove the `/import` object from `PLACEHOLDERS`;
- add:

```tsx
const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import",
  component: () => <Import onDone={() => router.navigate({ to: "/iron-flies" })} />,
});
```

- add `importRoute` to `rootRoute.addChildren([...])`, before `...placeholderRoutes`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run apps/web`
Expected: PASS (new and existing web tests, including `Shell.test.tsx`)

- [ ] **Step 6: Commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web
git commit -m "feat(web): import page for oQuants exports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Extractor snippet and first live import

**Files:**
- Create: `scripts/oquants-extract.js`

**Interfaces:**
- Produces: clipboard JSON matching `oquantsPayloadSchema` (Task 3).

- [ ] **Step 1: Write the snippet**

`scripts/oquants-extract.js`:

```js
// oQuants → Trading Journal extractor.
// On oQuants, open Portfolio, press F12 → Console, paste this whole file, press Enter.
// It walks every page, expands every trade, and copies the table's text to the
// clipboard. It reads only what the page shows; no cookies, tokens or storage.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (check, timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (check()) return true;
      await sleep(100);
    }
    return false;
  };
  const text = (element) => (element ? element.innerText.trim() : "");
  const pagination = () => document.querySelector(".MuiTablePagination-root");

  if (!pagination()) {
    console.error("oQuants extract: no trades table found. Open the Portfolio page first.");
    return;
  }
  // The first <table> on the page is the P&L chart, so find the one that owns the pagination.
  const table = () => pagination().closest("table");
  const headers = [...table().querySelectorAll("thead th")].map(text);
  const typeColumn = headers.indexOf("Type");
  const DESIGNER = 'a[href*="/dashboard/designer/"]';

  const tradeRows = () => [...table().querySelectorAll("tbody tr")].filter((tr) => tr.querySelector(".oq-ticker-symbol"));
  const legRowsOf = (tr) => {
    const legs = [];
    for (let next = tr.nextElementSibling; next && !next.querySelector(".oq-ticker-symbol"); next = next.nextElementSibling) {
      if (/^(Call|Put)$/.test(text(next.cells[typeColumn]))) legs.push(next);
    }
    return legs;
  };
  const legCountInLink = (tr) => {
    const link = tr.querySelector(DESIGNER);
    if (!link) return 0;
    return [...new URL(link.href).searchParams.keys()].filter((key) => /^positions\[\d+\]\[type\]$/.test(key)).length;
  };
  const pageKey = () => tradeRows().map((tr) => tr.querySelector(DESIGNER)?.getAttribute("href")).join("|");
  const button = (label) => pagination().querySelector(`[aria-label="${label}"]`);

  const first = button("Go to first page");
  if (first && !first.disabled) {
    const before = pageKey();
    first.click();
    await waitFor(() => pageKey() !== before);
  }

  const trades = [];
  for (let page = 1; page <= 100; page++) {
    for (const tr of tradeRows()) {
      const expected = legCountInLink(tr);
      if (legRowsOf(tr).length < expected) {
        tr.cells[0].querySelector("button.MuiIconButton-root")?.click();
        if (!(await waitFor(() => legRowsOf(tr).length >= expected, 3000))) {
          console.warn(`oQuants extract: ${text(tr.querySelector(".oq-ticker-symbol"))} did not expand; its legs may be missing.`);
        }
      }
      trades.push({
        ticker: text(tr.querySelector(".oq-ticker-symbol")),
        cells: [...tr.cells].map(text),
        designerHref: tr.querySelector(DESIGNER)?.getAttribute("href") ?? "",
        legs: legRowsOf(tr).map((leg) => ({ cells: [...leg.cells].map(text) })),
      });
    }
    const next = button("Go to next page");
    if (!next || next.disabled) break;
    const before = pageKey();
    next.click();
    if (!(await waitFor(() => pageKey() !== before))) {
      console.error("oQuants extract: the next page never loaded; stopping with what was collected.");
      break;
    }
  }

  const pageCounter = text(pagination().querySelector(".MuiTablePagination-displayedRows")) || text(pagination());
  const payload = JSON.stringify({
    format: "oquants-cells/1",
    capturedAt: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pageCounter,
    headers,
    trades,
  });

  window.oquantsExport = payload;
  if (typeof copy === "function") {
    copy(payload);
    console.log(`Copied ${trades.length} trades (counter said "${pageCounter}"). Paste into the journal's Import page.`);
  } else {
    console.log(`Collected ${trades.length} trades. Run copy(oquantsExport) to copy them.`);
  }
})();
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS. If Biome flags the long lines, run `pnpm format` and re-check. If it flags `copy` as undeclared, add `// biome-ignore lint/correctness/noUndeclaredVariables: DevTools console helper` above the `copy(payload)` line.

- [ ] **Step 3: Commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add scripts/oquants-extract.js
git commit -m "feat: oQuants extractor snippet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: First live run (with the user)**

This needs the user's logged-in oQuants session, so hand it to them:

1. `pnpm start`, open `http://127.0.0.1:4178/import`.
2. On oQuants → Portfolio → F12 → Console, paste `scripts/oquants-extract.js`, press Enter. Expect `Copied N trades …`.
3. Paste into the Import page, click **Preview**. Check: the New count is plausible, ENVX shows `1 wing`, open/close times in ET look right, VRP and other strategies are Skipped, and any `doesn't reconcile` rows are few and explainable.
4. Click **Import N**. Open Iron Flies and spot-check two trades against oQuants (legs, P&L, fees).
5. Run the snippet and Preview again: everything should be "already imported".
6. Record what an open trade's Close Date looked like (the spec's last unknown). If parsing needs a fix, save the relevant cell text to the captures folder (never the repo), add a synthetic test in `parse.test.ts`, and fix.

---

## Self-Review Notes

- Spec §4 snippet → Task 8; §5 payload → Task 3; §6 parser rules 1–8 + counter → Task 4; §7 schema change → Tasks 1–2; §8.1–8.2 → Tasks 5–6; §8.3 (no undo; backup + per-trade delete) → Task 5–6 backup; §8.4 errors → Tasks 6–7; §9 page → Task 7; §11 tests → each task.
- Task 2 is not named in the spec but is required by it: without it the builder cannot open an imported 1-wing trade, and saving any imported trade would erase its `sourceNotes`.
