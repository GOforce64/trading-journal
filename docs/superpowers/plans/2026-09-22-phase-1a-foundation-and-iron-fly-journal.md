# Phase 1a: Foundation and Iron Fly Journal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running local-first trading journal in which iron fly trades can be entered by hand, viewed with correct metrics, tagged, graded and excluded from stats — with the data stored outside the repository.

**Architecture:** A pnpm monorepo. `packages/core` holds pure domain logic (schemas, money math, iron fly metrics) with no I/O. `packages/db` holds the Drizzle schema, migrations and repositories over a local SQLite file. `apps/server` is a Hono app built by a `createApp(deps)` factory, so it can be driven by tests and later by an in-browser demo. `apps/web` is a React SPA that talks to it through a typed Hono RPC client. One Node process serves API and UI on `127.0.0.1:4178`.

**Tech Stack:** TypeScript (strict, ESM) · Node ≥ 22 · pnpm workspaces · Hono 4 · better-sqlite3 13 · Drizzle ORM 0.45 · React 19 · Vite 8 · Tailwind CSS 4 · TanStack Router + Query · Vitest 5 · Biome 2 · GitHub Actions (Ubuntu + Windows)

**Spec:** `docs/superpowers/specs/2026-09-22-trading-journal-design.md`

## Global Constraints

- **Node ≥ 22**, pnpm workspaces, every package `"type": "module"`, TypeScript `strict: true`.
- **No Docker.** Everything must run natively on Fedora Linux and Windows; CI proves it on both.
- **User data never enters the repo.** The database, attachments and backups live in the data directory: `TJ_DATA_DIR` if set, else `$XDG_DATA_HOME/trading-journal` (fallback `~/.local/share/trading-journal`) on Linux, `%APPDATA%\trading-journal` on Windows.
- **Timestamps** are stored as integer epoch milliseconds, UTC. Market-facing display uses `America/New_York`.
- **Money** is stored as REAL dollars. Option prices are per share; the contract multiplier is stored per leg (default 100).
- **IDs** are UUID strings. Manual trades use `crypto.randomUUID()`.
- **Soft delete only:** `deletedAt` is set; rows are never removed. Every syncable row carries `createdAt`, `updatedAt`, `deletedAt`, and trades additionally carry `editedAt` (last *user* edit, null when never edited by hand).
- **Terminal theme tokens** (spec §10): background `#0b0e14`, panel `#131722`, border `#1f2430`, text `#d1d4dc`, muted `#6b7385`, accent `#2962ff`, up `#26a69a`, down `#ef5350`. Inter for text, JetBrains Mono for all numbers.
- **TDD:** every task writes a failing test first, then the minimal implementation. Commit at the end of every task.
- **Server binds loopback only** and rejects requests whose `Host` header is not `localhost`/`127.0.0.1`.

## Deviations from the spec (deliberate, noted here so they aren't mistaken for gaps)

- The spec names **shadcn/ui**. Its CLI is interactive, which does not suit unattended task execution. This phase hand-writes the handful of primitives it needs against the same Tailwind tokens and Radix packages. `pnpm dlx shadcn@latest add <component>` remains available later without rework.
- **TanStack Router** is used with a code-defined route tree rather than the file-based plugin, to keep generated files out of the task flow.

## File structure produced by this plan

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, biome.json, .nvmrc
.github/workflows/ci.yml
scripts/start.sh, scripts/start.cmd
packages/core/         src/money.ts, src/model.ts, src/ironFly.ts, src/index.ts (+ tests)
packages/db/           src/schema.ts, src/client.ts, src/migrate.ts,
                       src/repositories/trades.ts, src/repositories/taxonomy.ts,
                       drizzle.config.ts, migrations/ (+ tests)
apps/server/           src/config.ts, src/app.ts, src/routes/trades.ts,
                       src/routes/taxonomy.ts, src/index.ts (+ tests)
apps/web/              index.html, vite.config.ts, src/main.tsx, src/router.tsx,
                       src/api.ts, src/theme.css, src/components/*, src/routes/* (+ tests)
```

Responsibilities: `core` knows the domain and nothing else; `db` owns persistence; `server` owns transport, validation and wiring; `web` owns presentation. `core` imports nothing from the others.

---

### Task 1: Repository skeleton, tooling and CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.nvmrc`, `LICENSE`, `README.md`, `.github/workflows/ci.yml`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/money.ts`, `packages/core/src/money.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the workspace itself; `@tj/core` exporting `round2(value: number): number` and `sumMoney(values: number[]): number`.

- [ ] **Step 1: Create the workspace files**

`package.json`:

```json
{
  "name": "trading-journal",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b",
    "lint": "biome check .",
    "format": "biome check --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.14",
    "typescript": "^5.9.0",
    "vitest": "^5.0.1"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": true
  }
}
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.14/schema.json",
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 110 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "files": { "includes": ["**", "!**/dist", "!**/migrations", "!.superpowers"] }
}
```

`.nvmrc` containing `22`. `LICENSE` is the MIT license text with `Copyright (c) 2026 Giorgos Zambas`.

- [ ] **Step 2: Create the core package with a failing test**

`packages/core/package.json`:

```json
{
  "name": "@tj/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^4.0.0" }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/core/src/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { round2, sumMoney } from "./money.js";

describe("money", () => {
  it("rounds to cents, away from zero at the half", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(512.0649)).toBe(512.06);
  });

  it("sums without float drift", () => {
    expect(sumMoney([-840, -640, 140, 140])).toBe(-1200);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });
});
```

- [ ] **Step 3: Install dependencies and run the test to verify it fails**

Run:

```bash
pnpm install
pnpm vitest run packages/core/src/money.test.ts
```

Expected: FAIL — cannot resolve `./money.js`.

- [ ] **Step 4: Implement `money.ts`**

`packages/core/src/money.ts`:

```ts
/** Round to cents. Uses epsilon nudging so 1.005 -> 1.01 rather than 1.00. */
export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + Number.EPSILON * 100)) / 100;
}

/** Sum dollar amounts, rounding once at the end to kill float drift. */
export function sumMoney(values: number[]): number {
  return round2(values.reduce((total, value) => total + value, 0));
}
```

`packages/core/src/index.ts`:

```ts
export * from "./money.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/src/money.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Add CI that runs on Ubuntu and Windows**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  check:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 7: Verify the whole check suite passes locally**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all three succeed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm workspace, tooling and CI"
```

---

### Task 2: Domain model schemas in core

**Files:**
- Create: `packages/core/src/model.ts`, `packages/core/src/model.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - types `Strategy = "scalp" | "iron_fly"`, `Book = "live" | "paper" | "missed"`, `Grade = "A"|"B"|"C"|"D"|"F"`, `OptionRight = "C" | "P"`, `TradeSource = "ibkr_flex" | "csv_import" | "oquants_extract" | "manual"`
  - `legInputSchema`, `ironFlyDetailsSchema`, `newTradeSchema`, `tradePatchSchema` (all Zod)
  - inferred types `LegInput`, `IronFlyDetailsInput`, `NewTrade`, `TradePatch`

- [ ] **Step 1: Write the failing test**

`packages/core/src/model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newTradeSchema, tradePatchSchema } from "./model.js";

const sampleFly = {
  strategy: "iron_fly" as const,
  book: "live" as const,
  underlying: "XYZ",
  underlyingName: "XYZ Industries",
  structureLabel: "Short Iron Butterfly",
  openedAt: 1788_000_000_000,
  closedAt: 1788_086_400_000,
  netPnl: 512,
  fees: 8,
  source: "manual" as const,
  legs: [
    { right: "C" as const, strike: 50, expiry: "2026-10-16", quantity: -4, openPrice: 2.1, closePrice: 1 },
    { right: "P" as const, strike: 50, expiry: "2026-10-16", quantity: -4, openPrice: 1.6, closePrice: 0.8 },
    { right: "C" as const, strike: 58, expiry: "2026-10-16", quantity: 4, openPrice: 0.35, closePrice: 0.05 },
    { right: "P" as const, strike: 45, expiry: "2026-10-16", quantity: 4, openPrice: 0.35, closePrice: 0.05 },
  ],
  ironFly: {
    bodyPutStrike: 50,
    bodyCallStrike: 50,
    putWingStrike: 45,
    callWingStrike: 58,
    contracts: 4,
    creditPerShare: 3,
    netCost: -1192,
  },
};

describe("newTradeSchema", () => {
  it("accepts a complete iron fly", () => {
    const parsed = newTradeSchema.parse(sampleFly);
    expect(parsed.underlying).toBe("XYZ");
    expect(parsed.legs).toHaveLength(4);
    expect(parsed.ironFly?.contracts).toBe(5);
  });

  it("upper-cases the underlying and trims it", () => {
    expect(newTradeSchema.parse({ ...sampleFly, underlying: " xyz " }).underlying).toBe("XYZ");
  });

  it("rejects an iron fly whose close precedes its open", () => {
    const result = newTradeSchema.safeParse({ ...sampleFly, closedAt: sampleFly.openedAt - 1 });
    expect(result.success).toBe(false);
  });

  it("rejects a leg with zero quantity", () => {
    const legs = [{ ...sampleFly.legs[0], quantity: 0 }, ...sampleFly.legs.slice(1)];
    expect(newTradeSchema.safeParse({ ...sampleFly, legs }).success).toBe(false);
  });

  it("requires iron fly details for an iron_fly trade", () => {
    const { ironFly, ...withoutDetails } = sampleFly;
    expect(newTradeSchema.safeParse(withoutDetails).success).toBe(false);
  });

  it("allows a patch that only sets the grade", () => {
    expect(tradePatchSchema.parse({ grade: "B" })).toEqual({ grade: "B" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/src/model.test.ts`
Expected: FAIL — cannot resolve `./model.js`.

- [ ] **Step 3: Implement `model.ts`**

`packages/core/src/model.ts`:

```ts
import { z } from "zod";

export const STRATEGIES = ["scalp", "iron_fly"] as const;
export const BOOKS = ["live", "paper", "missed"] as const;
export const GRADES = ["A", "B", "C", "D", "F"] as const;
export const SOURCES = ["ibkr_flex", "csv_import", "oquants_extract", "manual"] as const;

export type Strategy = (typeof STRATEGIES)[number];
export type Book = (typeof BOOKS)[number];
export type Grade = (typeof GRADES)[number];
export type TradeSource = (typeof SOURCES)[number];
export type OptionRight = "C" | "P";

const epochMs = z.number().int().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const legInputSchema = z.object({
  right: z.enum(["C", "P"]),
  strike: z.number().positive(),
  expiry: isoDate,
  /** Signed: negative is short, positive is long. Never zero. */
  quantity: z.number().int().refine((q) => q !== 0, "quantity cannot be zero"),
  multiplier: z.number().positive().default(100),
  openPrice: z.number().min(0),
  closePrice: z.number().min(0).nullable().default(null),
});

export const ironFlyDetailsSchema = z.object({
  bodyPutStrike: z.number().positive(),
  bodyCallStrike: z.number().positive(),
  putWingStrike: z.number().positive(),
  callWingStrike: z.number().positive(),
  contracts: z.number().int().positive(),
  /** Gross credit per share, before fees. */
  creditPerShare: z.number(),
  /** Cash flow at open; negative means credit received. */
  netCost: z.number().nullable().default(null),
  earningsDate: isoDate.nullable().default(null),
  earningsTiming: z.enum(["BMO", "AMC"]).nullable().default(null),
  impliedMovePct: z.number().nullable().default(null),
  actualMovePct: z.number().nullable().default(null),
  ivBefore: z.number().nullable().default(null),
  ivAfter: z.number().nullable().default(null),
  sourceNotes: z.string().nullable().default(null),
});

export const newTradeSchema = z
  .object({
    strategy: z.enum(STRATEGIES),
    book: z.enum(BOOKS),
    underlying: z.string().trim().min(1).max(12).transform((s) => s.toUpperCase()),
    underlyingName: z.string().trim().max(120).nullable().default(null),
    structureLabel: z.string().trim().max(60).nullable().default(null),
    openedAt: epochMs,
    closedAt: epochMs.nullable().default(null),
    netPnl: z.number().nullable().default(null),
    fees: z.number().min(0).default(0),
    notes: z.string().max(10_000).nullable().default(null),
    grade: z.enum(GRADES).nullable().default(null),
    excluded: z.boolean().default(false),
    excludeReason: z.string().max(200).nullable().default(null),
    source: z.enum(SOURCES).default("manual"),
    setupId: z.string().uuid().nullable().default(null),
    tagIds: z.array(z.string().uuid()).default([]),
    legs: z.array(legInputSchema).max(8).default([]),
    ironFly: ironFlyDetailsSchema.nullish().default(null),
  })
  .refine((t) => t.closedAt === null || t.closedAt >= t.openedAt, {
    message: "closedAt must be at or after openedAt",
    path: ["closedAt"],
  })
  .refine((t) => t.strategy !== "iron_fly" || t.ironFly != null, {
    message: "iron_fly trades require ironFly details",
    path: ["ironFly"],
  });

export const tradePatchSchema = newTradeSchema
  .innerType()
  .partial()
  .omit({ source: true });

export type LegInput = z.infer<typeof legInputSchema>;
export type IronFlyDetailsInput = z.infer<typeof ironFlyDetailsSchema>;
export type NewTrade = z.infer<typeof newTradeSchema>;
export type TradePatch = z.infer<typeof tradePatchSchema>;
```

Add `export * from "./model.js";` to `packages/core/src/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/src/model.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add trade and iron fly schemas"
```

---

### Task 3: Iron fly metrics in core

This is the task that makes the journal worth having. The fixture is a synthetic broken-wing fly whose arithmetic reconciles end to end, so the numbers are checkable by hand.

**Files:**
- Create: `packages/core/src/ironFly.ts`, `packages/core/src/ironFly.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `round2` from Task 1; `IronFlyDetailsInput` from Task 2.
- Produces:
  - `ironFlyMetrics(input: IronFlyMetricsInput): IronFlyMetrics` where `IronFlyMetricsInput = { bodyPutStrike, bodyCallStrike, putWingStrike, callWingStrike, contracts, creditPerShare, fees?, multiplier? }`
  - `IronFlyMetrics = { shares, putWingWidth, callWingWidth, isBrokenWing, netCreditPerShare, maxProfit, putSideRisk, callSideRisk, maxLoss, riskySide, breakevenLow, breakevenHigh }`
  - `ironFlyOutcome(metrics: IronFlyMetrics, netPnl: number): { returnOnRisk: number | null; pctOfMaxProfit: number | null; pnlPctOfCost: number | null }`
  - `derivedFees(legs: { quantity: number; multiplier: number; openPrice: number }[], netCost: number): number`

- [ ] **Step 1: Write the failing test**

`packages/core/src/ironFly.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { derivedFees, ironFlyMetrics, ironFlyOutcome } from "./ironFly.js";

/** Sample broken-wing fly: short 50 straddle, wings 45 / 58, 4 lots, $1,200 credit, $8.00 fees. */
const sampleFly = {
  bodyPutStrike: 50,
  bodyCallStrike: 50,
  putWingStrike: 45,
  callWingStrike: 58,
  contracts: 4,
  creditPerShare: 3,
  fees: 8,
};

describe("ironFlyMetrics", () => {
  it("measures each wing separately when they are not equal", () => {
    const m = ironFlyMetrics(sampleFly);
    expect(m.putWingWidth).toBe(5);
    expect(m.callWingWidth).toBe(8);
    expect(m.isBrokenWing).toBe(true);
  });

  it("nets fees out of the credit", () => {
    const m = ironFlyMetrics(sampleFly);
    expect(m.netCreditPerShare).toBeCloseTo(2.98, 5);
    expect(m.maxProfit).toBe(1192);
  });

  it("takes max loss from the wider wing and names that side", () => {
    const m = ironFlyMetrics(sampleFly);
    expect(m.putSideRisk).toBe(808);
    expect(m.callSideRisk).toBe(2008);
    expect(m.maxLoss).toBe(2008);
    expect(m.riskySide).toBe("call");
  });

  it("puts breakevens at the body plus and minus the net credit", () => {
    const m = ironFlyMetrics(sampleFly);
    expect(m.breakevenLow).toBe(47.02);
    expect(m.breakevenHigh).toBe(52.98);
  });

  it("treats a symmetric fly as unbroken", () => {
    const m = ironFlyMetrics({ ...sampleFly, callWingStrike: 55, putWingStrike: 45 });
    expect(m.isBrokenWing).toBe(true);
    const even = ironFlyMetrics({ ...sampleFly, callWingStrike: 55, putWingStrike: 45, bodyPutStrike: 50 });
    expect(even.putWingWidth).toBe(5);
  });

  it("clamps risk at zero when the credit exceeds the wing", () => {
    const m = ironFlyMetrics({ ...sampleFly, creditPerShare: 6, fees: 0 });
    expect(m.putSideRisk).toBe(0);
    expect(m.maxLoss).toBe(0);
  });
});

describe("ironFlyOutcome", () => {
  it("reports return on risk, share of max profit, and P&L % of cost", () => {
    const m = ironFlyMetrics(sampleFly);
    const o = ironFlyOutcome(m, 512);
    expect(o.returnOnRisk).toBeCloseTo(0.255, 4);
    expect(o.pctOfMaxProfit).toBeCloseTo(0.4295, 4);
    expect(o.pnlPctOfCost).toBeCloseTo(0.4295, 4);
  });

  it("returns null return-on-risk when there is no risk to divide by", () => {
    const m = ironFlyMetrics({ ...sampleFly, creditPerShare: 6, fees: 0 });
    expect(ironFlyOutcome(m, 100).returnOnRisk).toBeNull();
  });
});

describe("derivedFees", () => {
  it("recovers fees from the gap between leg cash and the reported cost", () => {
    const legs = [
      { quantity: -4, multiplier: 100, openPrice: 2.1 },
      { quantity: -4, multiplier: 100, openPrice: 1.6 },
      { quantity: 4, multiplier: 100, openPrice: 0.35 },
      { quantity: 4, multiplier: 100, openPrice: 0.35 },
    ];
    expect(derivedFees(legs, -1192)).toBe(8);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/src/ironFly.test.ts`
Expected: FAIL — cannot resolve `./ironFly.js`.

- [ ] **Step 3: Implement `ironFly.ts`**

`packages/core/src/ironFly.ts`:

```ts
import { round2 } from "./money.js";

export interface IronFlyMetricsInput {
  bodyPutStrike: number;
  bodyCallStrike: number;
  putWingStrike: number;
  callWingStrike: number;
  contracts: number;
  /** Gross credit per share, before fees. */
  creditPerShare: number;
  /** Total fees in dollars for the whole position. */
  fees?: number;
  multiplier?: number;
}

export interface IronFlyMetrics {
  shares: number;
  putWingWidth: number;
  callWingWidth: number;
  isBrokenWing: boolean;
  netCreditPerShare: number;
  maxProfit: number;
  putSideRisk: number;
  callSideRisk: number;
  maxLoss: number;
  riskySide: "put" | "call" | "even";
  breakevenLow: number;
  breakevenHigh: number;
}

/**
 * Wings are treated independently, so broken-wing flies are handled: each side's
 * risk is its own width minus the credit, and max loss is the larger of the two.
 */
export function ironFlyMetrics(input: IronFlyMetricsInput): IronFlyMetrics {
  const multiplier = input.multiplier ?? 100;
  const shares = input.contracts * multiplier;
  const fees = input.fees ?? 0;
  const netCreditPerShare = input.creditPerShare - fees / shares;

  const putWingWidth = round2(input.bodyPutStrike - input.putWingStrike);
  const callWingWidth = round2(input.callWingStrike - input.bodyCallStrike);
  const putSideRisk = round2(Math.max(0, (putWingWidth - netCreditPerShare) * shares));
  const callSideRisk = round2(Math.max(0, (callWingWidth - netCreditPerShare) * shares));
  const maxLoss = Math.max(putSideRisk, callSideRisk);

  return {
    shares,
    putWingWidth,
    callWingWidth,
    isBrokenWing: putWingWidth !== callWingWidth,
    netCreditPerShare,
    maxProfit: round2(netCreditPerShare * shares),
    putSideRisk,
    callSideRisk,
    maxLoss,
    riskySide: callSideRisk === putSideRisk ? "even" : callSideRisk > putSideRisk ? "call" : "put",
    breakevenLow: round2(input.bodyPutStrike - netCreditPerShare),
    breakevenHigh: round2(input.bodyCallStrike + netCreditPerShare),
  };
}

export interface IronFlyOutcome {
  returnOnRisk: number | null;
  pctOfMaxProfit: number | null;
  pnlPctOfCost: number | null;
}

/**
 * Ratios are fractions, not percentages: 0.2550 means +25.50%.
 * pnlPctOfCost mirrors the number oQuants shows, so imported rows reconcile.
 */
export function ironFlyOutcome(metrics: IronFlyMetrics, netPnl: number): IronFlyOutcome {
  return {
    returnOnRisk: metrics.maxLoss > 0 ? netPnl / metrics.maxLoss : null,
    pctOfMaxProfit: metrics.maxProfit !== 0 ? netPnl / metrics.maxProfit : null,
    pnlPctOfCost: metrics.maxProfit !== 0 ? netPnl / Math.abs(metrics.maxProfit) : null,
  };
}

/**
 * Fees are not reported directly by oQuants; they are the difference between the
 * cash the legs imply and the cost on the row. Positive result means fees paid.
 */
export function derivedFees(
  legs: { quantity: number; multiplier: number; openPrice: number }[],
  netCost: number,
): number {
  const legCash = legs.reduce((total, leg) => total + leg.quantity * leg.multiplier * leg.openPrice, 0);
  return round2(netCost - legCash);
}
```

Add `export * from "./ironFly.js";` to `packages/core/src/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/src/ironFly.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): iron fly metrics with independent wings"
```

---

### Task 4: Database schema, migrations and backups

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`, `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/migrate.ts`, `packages/db/src/index.ts`, `packages/db/src/migrate.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (schema mirrors the core types by value, not by import).
- Produces:
  - `openDatabase(filePath: string): Db` where `type Db = BetterSQLite3Database<typeof schema>`
  - `runMigrations(filePath: string, options: { migrationsFolder: string; backupDir?: string; keepBackups?: number }): void`
  - `schema` tables: `accounts`, `trades`, `legs`, `ironFlyDetails`, `setups`, `tags`, `tradeTags`

- [ ] **Step 1: Create the package and install dependencies**

`packages/db/package.json`:

```json
{
  "name": "@tj/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "generate": "drizzle-kit generate" },
  "dependencies": {
    "@tj/core": "workspace:*",
    "better-sqlite3": "^13.0.3",
    "drizzle-orm": "^0.45.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "drizzle-kit": "^0.31.11"
  }
}
```

`packages/db/tsconfig.json` mirrors `packages/core/tsconfig.json`.

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/db/src/migrate.test.ts`:

```ts
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "./index.js";
import { trades } from "./schema.js";

const MIGRATIONS = new URL("../migrations", import.meta.url).pathname;

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "tj-test-"));
}

describe("runMigrations", () => {
  it("creates the schema in a fresh database", () => {
    const dir = tempDir();
    const file = join(dir, "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const db = openDatabase(file);
    expect(db.select().from(trades).all()).toEqual([]);
  });

  it("is safe to run twice", () => {
    const dir = tempDir();
    const file = join(dir, "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    expect(() => runMigrations(file, { migrationsFolder: MIGRATIONS })).not.toThrow();
  });

  it("backs up an existing database before migrating", () => {
    const dir = tempDir();
    const file = join(dir, "journal.db");
    const backupDir = join(dir, "backups");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    runMigrations(file, { migrationsFolder: MIGRATIONS, backupDir });
    expect(readdirSync(backupDir).filter((f) => f.endsWith(".db"))).toHaveLength(1);
  });

  it("keeps only the most recent backups", () => {
    const dir = tempDir();
    const file = join(dir, "journal.db");
    const backupDir = join(dir, "backups");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(backupDir, `journal-old-${i}.db`), "x", { flag: "w" });
    }
    runMigrations(file, { migrationsFolder: MIGRATIONS, backupDir, keepBackups: 2 });
    expect(readdirSync(backupDir).filter((f) => f.endsWith(".db"))).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run packages/db`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 4: Write the schema**

`packages/db/src/schema.ts`:

```ts
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Columns every syncable row carries (spec §12). */
const syncColumns = {
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
};

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  broker: text("broker").notNull().default("ibkr"),
  kind: text("kind").notNull(), // 'live' | 'paper'
  externalId: text("external_id"),
  ...syncColumns,
});

export const trades = sqliteTable(
  "trades",
  {
    id: text("id").primaryKey(),
    strategy: text("strategy").notNull(), // 'scalp' | 'iron_fly'
    book: text("book").notNull(), // 'live' | 'paper' | 'missed'
    accountId: text("account_id").references(() => accounts.id),
    underlying: text("underlying").notNull(),
    underlyingName: text("underlying_name"),
    structureLabel: text("structure_label"),
    openedAt: integer("opened_at").notNull(),
    closedAt: integer("closed_at"),
    netPnl: real("net_pnl"),
    fees: real("fees").notNull().default(0),
    notes: text("notes"),
    grade: text("grade"),
    setupId: text("setup_id").references(() => setups.id),
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    excludeReason: text("exclude_reason"),
    source: text("source").notNull().default("manual"),
    externalRef: text("external_ref"),
    importBatchId: text("import_batch_id"),
    /** Last edit made by a person; null when only ever written by an importer or sync. */
    editedAt: integer("edited_at"),
    ...syncColumns,
  },
  (t) => [
    index("trades_opened_at_idx").on(t.openedAt),
    index("trades_strategy_book_idx").on(t.strategy, t.book),
    index("trades_underlying_idx").on(t.underlying),
  ],
);

export const legs = sqliteTable(
  "legs",
  {
    id: text("id").primaryKey(),
    tradeId: text("trade_id")
      .notNull()
      .references(() => trades.id),
    right: text("right").notNull(), // 'C' | 'P'
    strike: real("strike").notNull(),
    expiry: text("expiry").notNull(), // YYYY-MM-DD
    quantity: integer("quantity").notNull(), // signed
    multiplier: integer("multiplier").notNull().default(100),
    openPrice: real("open_price").notNull(),
    closePrice: real("close_price"),
    ...syncColumns,
  },
  (t) => [index("legs_trade_idx").on(t.tradeId)],
);

export const ironFlyDetails = sqliteTable("iron_fly_details", {
  tradeId: text("trade_id")
    .primaryKey()
    .references(() => trades.id),
  bodyPutStrike: real("body_put_strike"),
  bodyCallStrike: real("body_call_strike"),
  putWingStrike: real("put_wing_strike"),
  callWingStrike: real("call_wing_strike"),
  contracts: integer("contracts"),
  creditPerShare: real("credit_per_share"),
  netCost: real("net_cost"),
  earningsDate: text("earnings_date"),
  earningsTiming: text("earnings_timing"),
  impliedMovePct: real("implied_move_pct"),
  actualMovePct: real("actual_move_pct"),
  ivBefore: real("iv_before"),
  ivAfter: real("iv_after"),
  sourceNotes: text("source_notes"),
});

export const setups = sqliteTable("setups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  strategy: text("strategy"), // null = applies to both
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...syncColumns,
});

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // 'mistake' | 'emotion'
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    ...syncColumns,
  },
  (t) => [uniqueIndex("tags_kind_name_idx").on(t.kind, t.name)],
);

export const tradeTags = sqliteTable(
  "trade_tags",
  {
    tradeId: text("trade_id")
      .notNull()
      .references(() => trades.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (t) => [uniqueIndex("trade_tags_pk").on(t.tradeId, t.tagId)],
);
```

- [ ] **Step 5: Write the client, the migrator and the barrel file**

`packages/db/src/client.ts`:

```ts
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

export function openDatabase(filePath: string): Db {
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}
```

`packages/db/src/migrate.ts`:

```ts
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "./client.js";

export interface MigrateOptions {
  migrationsFolder: string;
  backupDir?: string;
  keepBackups?: number;
}

/** Snapshot the database, prune old snapshots, then apply pending migrations. */
export function runMigrations(filePath: string, options: MigrateOptions): void {
  const { migrationsFolder, backupDir, keepBackups = 10 } = options;

  if (backupDir && existsSync(filePath)) {
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(filePath, join(backupDir, `journal-${stamp}.db`));
    pruneBackups(backupDir, keepBackups);
  }

  const db = openDatabase(filePath);
  migrate(db, { migrationsFolder });
}

function pruneBackups(backupDir: string, keep: number): void {
  const files = readdirSync(backupDir)
    .filter((name) => name.endsWith(".db"))
    .map((name) => ({ name, mtime: statSync(join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const file of files.slice(keep)) unlinkSync(join(backupDir, file.name));
}
```

`packages/db/src/index.ts`:

```ts
export * from "./client.js";
export * from "./migrate.js";
export * as schema from "./schema.js";
```

`packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
```

- [ ] **Step 6: Generate the migration**

Run: `pnpm --filter @tj/db generate`
Expected: a `packages/db/migrations/0000_*.sql` file plus a `meta/` folder. Commit them; they are the migration history.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db`
Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): schema, migrations and pre-migration backups"
```

---

### Task 5: Trades repository

**Files:**
- Create: `packages/db/src/repositories/trades.ts`, `packages/db/src/repositories/trades.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `Db` and `schema` from Task 4; `NewTrade`, `TradePatch` from Task 2.
- Produces: `createTradesRepo(db: Db, now?: () => number)` returning
  - `create(input: NewTrade): TradeRecord`
  - `get(id: string): TradeRecord | null`
  - `list(filter?: TradeFilter): TradeRecord[]` with `TradeFilter = { strategy?, book?, underlying?, includeExcluded?, limit? }`
  - `update(id: string, patch: TradePatch): TradeRecord | null`
  - `softDelete(id: string): boolean`
  - `TradeRecord = trades row + { legs, ironFly, tagIds }`

- [ ] **Step 1: Write the failing test**

`packages/db/src/repositories/trades.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { createTradesRepo } from "./trades.js";

const MIGRATIONS = new URL("../../migrations", import.meta.url).pathname;

const sampleFly = {
  strategy: "iron_fly",
  book: "live",
  underlying: "XYZ",
  underlyingName: "XYZ Industries",
  structureLabel: "Short Iron Butterfly",
  openedAt: 1788_000_000_000,
  closedAt: 1788_086_400_000,
  netPnl: 512,
  fees: 8,
  notes: null,
  grade: null,
  excluded: false,
  excludeReason: null,
  source: "manual",
  setupId: null,
  tagIds: [],
  legs: [
    { right: "C", strike: 50, expiry: "2026-10-16", quantity: -4, multiplier: 100, openPrice: 2.1, closePrice: 1 },
    { right: "P", strike: 50, expiry: "2026-10-16", quantity: -4, multiplier: 100, openPrice: 1.6, closePrice: 0.8 },
  ],
  ironFly: {
    bodyPutStrike: 50,
    bodyCallStrike: 50,
    putWingStrike: 45,
    callWingStrike: 58,
    contracts: 4,
    creditPerShare: 3,
    netCost: -1192,
    earningsDate: "2026-09-10",
    earningsTiming: "AMC",
    impliedMovePct: null,
    actualMovePct: null,
    ivBefore: null,
    ivAfter: null,
    sourceNotes: "96 if near close",
  },
} as const;

describe("trades repository", () => {
  let db: Db;
  let clock = 1_000;
  const repo = () => createTradesRepo(db, () => clock);

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-repo-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
    clock = 1_000;
  });

  it("stores a trade with its legs and iron fly details", () => {
    const created = repo().create({ ...sampleFly });
    const found = repo().get(created.id);
    expect(found?.underlying).toBe("XYZ");
    expect(found?.legs).toHaveLength(2);
    expect(found?.ironFly?.callWingStrike).toBe(27);
    expect(found?.editedAt).toBe(1_000);
  });

  it("filters by strategy and book, newest first", () => {
    const r = repo();
    r.create({ ...sampleFly, openedAt: 1000 });
    r.create({ ...sampleFly, openedAt: 5000, book: "paper" });
    expect(r.list({ book: "live" })).toHaveLength(1);
    expect(r.list()[0]?.openedAt).toBe(5000);
  });

  it("hides excluded trades unless asked for them", () => {
    const r = repo();
    r.create({ ...sampleFly, excluded: true, excludeReason: "test trade" });
    expect(r.list()).toHaveLength(0);
    expect(r.list({ includeExcluded: true })).toHaveLength(1);
  });

  it("updates a patch and bumps editedAt", () => {
    const r = repo();
    const created = r.create({ ...sampleFly });
    clock = 2_000;
    const updated = r.update(created.id, { grade: "B", notes: "crush paid" });
    expect(updated?.grade).toBe("B");
    expect(updated?.editedAt).toBe(2_000);
  });

  it("replaces legs wholesale when a patch includes them", () => {
    const r = repo();
    const created = r.create({ ...sampleFly });
    const updated = r.update(created.id, {
      legs: [{ right: "C", strike: 61, expiry: "2026-10-16", quantity: 1, multiplier: 100, openPrice: 0.05, closePrice: null }],
    });
    expect(updated?.legs).toHaveLength(1);
    expect(updated?.legs[0]?.strike).toBe(30);
  });

  it("soft deletes, hiding the trade from list but keeping the row", () => {
    const r = repo();
    const created = r.create({ ...sampleFly });
    expect(r.softDelete(created.id)).toBe(true);
    expect(r.list()).toHaveLength(0);
    expect(r.get(created.id)).toBeNull();
  });

  it("returns null when updating a trade that does not exist", () => {
    expect(repo().update(crypto.randomUUID(), { grade: "A" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/db/src/repositories`
Expected: FAIL — cannot resolve `./trades.js`.

- [ ] **Step 3: Implement the repository**

`packages/db/src/repositories/trades.ts`:

```ts
import type { NewTrade, TradePatch } from "@tj/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../client.js";
import { ironFlyDetails, legs, trades, tradeTags } from "../schema.js";

export type TradeRow = typeof trades.$inferSelect;
export type LegRow = typeof legs.$inferSelect;
export type IronFlyRow = typeof ironFlyDetails.$inferSelect;

export interface TradeRecord extends TradeRow {
  legs: LegRow[];
  ironFly: IronFlyRow | null;
  tagIds: string[];
}

export interface TradeFilter {
  strategy?: string;
  book?: string;
  underlying?: string;
  includeExcluded?: boolean;
  limit?: number;
}

export function createTradesRepo(db: Db, now: () => number = Date.now) {
  function hydrate(row: TradeRow): TradeRecord {
    return {
      ...row,
      legs: db.select().from(legs).where(and(eq(legs.tradeId, row.id), isNull(legs.deletedAt))).all(),
      ironFly: db.select().from(ironFlyDetails).where(eq(ironFlyDetails.tradeId, row.id)).get() ?? null,
      tagIds: db
        .select({ tagId: tradeTags.tagId })
        .from(tradeTags)
        .where(eq(tradeTags.tradeId, row.id))
        .all()
        .map((r) => r.tagId),
    };
  }

  function writeChildren(tradeId: string, input: Partial<NewTrade>, timestamp: number): void {
    if (input.legs) {
      db.delete(legs).where(eq(legs.tradeId, tradeId)).run();
      for (const leg of input.legs) {
        db.insert(legs)
          .values({
            id: crypto.randomUUID(),
            tradeId,
            right: leg.right,
            strike: leg.strike,
            expiry: leg.expiry,
            quantity: leg.quantity,
            multiplier: leg.multiplier,
            openPrice: leg.openPrice,
            closePrice: leg.closePrice,
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
          })
          .run();
      }
    }

    if (input.ironFly !== undefined) {
      db.delete(ironFlyDetails).where(eq(ironFlyDetails.tradeId, tradeId)).run();
      if (input.ironFly) {
        db.insert(ironFlyDetails).values({ tradeId, ...input.ironFly }).run();
      }
    }

    if (input.tagIds) {
      db.delete(tradeTags).where(eq(tradeTags.tradeId, tradeId)).run();
      for (const tagId of input.tagIds) db.insert(tradeTags).values({ tradeId, tagId }).run();
    }
  }

  return {
    create(input: NewTrade): TradeRecord {
      const timestamp = now();
      const id = crypto.randomUUID();
      return db.transaction((tx) => {
        void tx;
        db.insert(trades)
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
            notes: input.notes,
            grade: input.grade,
            setupId: input.setupId,
            excluded: input.excluded,
            excludeReason: input.excludeReason,
            source: input.source,
            externalRef: null,
            importBatchId: null,
            // Manual entry is a user edit, so editedAt is set from the start.
            editedAt: input.source === "manual" ? timestamp : null,
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
          })
          .run();
        writeChildren(id, input, timestamp);
        return hydrate(db.select().from(trades).where(eq(trades.id, id)).get()!);
      });
    },

    get(id: string): TradeRecord | null {
      const row = db.select().from(trades).where(and(eq(trades.id, id), isNull(trades.deletedAt))).get();
      return row ? hydrate(row) : null;
    },

    list(filter: TradeFilter = {}): TradeRecord[] {
      const conditions = [isNull(trades.deletedAt)];
      if (filter.strategy) conditions.push(eq(trades.strategy, filter.strategy));
      if (filter.book) conditions.push(eq(trades.book, filter.book));
      if (filter.underlying) conditions.push(eq(trades.underlying, filter.underlying.toUpperCase()));
      if (!filter.includeExcluded) conditions.push(eq(trades.excluded, false));
      return db
        .select()
        .from(trades)
        .where(and(...conditions))
        .orderBy(desc(trades.openedAt))
        .limit(filter.limit ?? 500)
        .all()
        .map(hydrate);
    },

    update(id: string, patch: TradePatch): TradeRecord | null {
      const existing = db.select().from(trades).where(and(eq(trades.id, id), isNull(trades.deletedAt))).get();
      if (!existing) return null;
      const timestamp = now();
      const { legs: _legs, ironFly: _ironFly, tagIds: _tagIds, ...columns } = patch;
      db.update(trades)
        .set({ ...columns, updatedAt: timestamp, editedAt: timestamp })
        .where(eq(trades.id, id))
        .run();
      writeChildren(id, patch, timestamp);
      return hydrate(db.select().from(trades).where(eq(trades.id, id)).get()!);
    },

    softDelete(id: string): boolean {
      const timestamp = now();
      const result = db
        .update(trades)
        .set({ deletedAt: timestamp, updatedAt: timestamp })
        .where(and(eq(trades.id, id), isNull(trades.deletedAt)))
        .run();
      return result.changes > 0;
    },
  };
}
```

Add `export * from "./repositories/trades.js";` to `packages/db/src/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db`
Expected: PASS, 11 tests (4 from Task 4, 7 here).

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): trades repository with legs, details and soft delete"
```

---

### Task 6: Taxonomy repository (setups and tags)

**Files:**
- Create: `packages/db/src/repositories/taxonomy.ts`, `packages/db/src/repositories/taxonomy.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `Db`, `schema` from Task 4.
- Produces: `createTaxonomyRepo(db: Db, now?: () => number)` returning
  - `listSetups(): SetupRow[]`, `createSetup(input: { name: string; description?: string | null; strategy?: string | null }): SetupRow`
  - `listTags(): TagRow[]`, `createTag(input: { name: string; kind: "mistake" | "emotion" }): TagRow`
  - `seedDefaults(): void` — inserts the starter playbook and mistake tags if the tables are empty

- [ ] **Step 1: Write the failing test**

`packages/db/src/repositories/taxonomy.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { createTaxonomyRepo } from "./taxonomy.js";

const MIGRATIONS = new URL("../../migrations", import.meta.url).pathname;

describe("taxonomy repository", () => {
  let db: Db;
  const repo = () => createTaxonomyRepo(db, () => 1_000);

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-tax-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
  });

  it("creates and lists setups", () => {
    const created = repo().createSetup({ name: "Earnings IV crush", strategy: "iron_fly" });
    expect(created.name).toBe("Earnings IV crush");
    expect(repo().listSetups()).toHaveLength(1);
  });

  it("creates tags of both kinds", () => {
    repo().createTag({ name: "Moved stop", kind: "mistake" });
    repo().createTag({ name: "Calm", kind: "emotion" });
    expect(repo().listTags().map((t) => t.kind).sort()).toEqual(["emotion", "mistake"]);
  });

  it("rejects a duplicate tag name within the same kind", () => {
    repo().createTag({ name: "FOMO entry", kind: "mistake" });
    expect(() => repo().createTag({ name: "FOMO entry", kind: "mistake" })).toThrow();
  });

  it("seeds defaults once and is idempotent", () => {
    repo().seedDefaults();
    const afterFirst = repo().listTags().length;
    repo().seedDefaults();
    expect(repo().listTags()).toHaveLength(afterFirst);
    expect(afterFirst).toBeGreaterThan(0);
    expect(repo().listSetups().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/db/src/repositories/taxonomy.test.ts`
Expected: FAIL — cannot resolve `./taxonomy.js`.

- [ ] **Step 3: Implement the repository**

`packages/db/src/repositories/taxonomy.ts`:

```ts
import { asc, eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { setups, tags } from "../schema.js";

export type SetupRow = typeof setups.$inferSelect;
export type TagRow = typeof tags.$inferSelect;

const DEFAULT_SETUPS = [
  { name: "Earnings IV crush", strategy: "iron_fly", description: "Short fly into earnings, out the next day" },
  { name: "ORB breakout", strategy: "scalp", description: "Break of the opening range" },
  { name: "VWAP reclaim", strategy: "scalp", description: "Reclaim of session VWAP after a flush" },
];

const DEFAULT_TAGS: { name: string; kind: "mistake" | "emotion" }[] = [
  { name: "Moved stop", kind: "mistake" },
  { name: "FOMO entry", kind: "mistake" },
  { name: "Oversized", kind: "mistake" },
  { name: "Exited early", kind: "mistake" },
  { name: "Calm", kind: "emotion" },
  { name: "Rushed", kind: "emotion" },
  { name: "Revenge", kind: "emotion" },
];

export function createTaxonomyRepo(db: Db, now: () => number = Date.now) {
  const stamps = () => {
    const timestamp = now();
    return { createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
  };

  return {
    listSetups(): SetupRow[] {
      return db.select().from(setups).where(eq(setups.archived, false)).orderBy(asc(setups.name)).all();
    },

    createSetup(input: { name: string; description?: string | null; strategy?: string | null }): SetupRow {
      const row = {
        id: crypto.randomUUID(),
        name: input.name,
        description: input.description ?? null,
        strategy: input.strategy ?? null,
        archived: false,
        ...stamps(),
      };
      db.insert(setups).values(row).run();
      return row;
    },

    listTags(): TagRow[] {
      return db.select().from(tags).where(eq(tags.archived, false)).orderBy(asc(tags.name)).all();
    },

    createTag(input: { name: string; kind: "mistake" | "emotion" }): TagRow {
      const row = { id: crypto.randomUUID(), name: input.name, kind: input.kind, archived: false, ...stamps() };
      db.insert(tags).values(row).run();
      return row;
    },

    /** First-run content so the app is usable immediately. Safe to call on every boot. */
    seedDefaults(): void {
      if (db.select().from(setups).all().length === 0) {
        for (const setup of DEFAULT_SETUPS) this.createSetup(setup);
      }
      if (db.select().from(tags).all().length === 0) {
        for (const tag of DEFAULT_TAGS) this.createTag(tag);
      }
    },
  };
}
```

Add `export * from "./repositories/taxonomy.js";` to `packages/db/src/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): setups and tags with first-run defaults"
```

---

### Task 7: Server app factory, config and the trades API

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/config.ts`, `apps/server/src/app.ts`, `apps/server/src/routes/trades.ts`, `apps/server/src/routes/taxonomy.ts`, `apps/server/src/index.ts`, `apps/server/src/app.test.ts`, `apps/server/src/config.test.ts`

**Interfaces:**
- Consumes: `createTradesRepo`, `createTaxonomyRepo`, `openDatabase`, `runMigrations` (Tasks 4–6); `newTradeSchema`, `tradePatchSchema` (Task 2).
- Produces:
  - `resolveDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string`
  - `dataPaths(dataDir: string): { dbFile: string; backupDir: string; attachmentsDir: string; secretsFile: string }`
  - `createApp(deps: { db: Db; now?: () => number }): Hono` with routes `GET/POST /api/trades`, `GET/PATCH/DELETE /api/trades/:id`, `GET/POST /api/setups`, `GET/POST /api/tags`, `GET /api/health`
  - `export type AppType = ReturnType<typeof createApp>` for the web client

- [ ] **Step 1: Create the package**

`apps/server/package.json`:

```json
{
  "name": "@tj/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "dev": "node --experimental-strip-types src/index.ts", "start": "node --experimental-strip-types src/index.ts" },
  "dependencies": {
    "@hono/node-server": "^2.1.1",
    "@hono/zod-validator": "^0.7.0",
    "@tj/core": "workspace:*",
    "@tj/db": "workspace:*",
    "hono": "^4.13.8",
    "zod": "^4.0.0"
  }
}
```

`apps/server/tsconfig.json` mirrors `packages/core/tsconfig.json`.

Run: `pnpm install`

- [ ] **Step 2: Write the failing config test**

`apps/server/src/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dataPaths, resolveDataDir } from "./config.js";

describe("resolveDataDir", () => {
  it("prefers TJ_DATA_DIR", () => {
    expect(resolveDataDir({ TJ_DATA_DIR: "/custom/spot" }, "linux", "/home/t")).toBe("/custom/spot");
  });

  it("uses XDG_DATA_HOME on Linux", () => {
    expect(resolveDataDir({ XDG_DATA_HOME: "/home/t/.local/share" }, "linux", "/home/t")).toBe(
      "/home/t/.local/share/trading-journal",
    );
  });

  it("falls back to ~/.local/share on Linux", () => {
    expect(resolveDataDir({}, "linux", "/home/t")).toBe("/home/t/.local/share/trading-journal");
  });

  it("uses APPDATA on Windows", () => {
    expect(resolveDataDir({ APPDATA: "C:\\Users\\t\\AppData\\Roaming" }, "win32", "C:\\Users\\t")).toBe(
      "C:\\Users\\t\\AppData\\Roaming\\trading-journal",
    );
  });
});

describe("dataPaths", () => {
  it("names every file inside the data directory", () => {
    const paths = dataPaths("/data/tj");
    expect(paths.dbFile.endsWith("journal.db")).toBe(true);
    expect(paths.backupDir.endsWith("backups")).toBe(true);
    expect(paths.attachmentsDir.endsWith("attachments")).toBe(true);
    expect(paths.secretsFile.endsWith("secrets.json")).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run apps/server/src/config.test.ts`
Expected: FAIL — cannot resolve `./config.js`.

- [ ] **Step 4: Implement `config.ts`**

`apps/server/src/config.ts`:

```ts
import { join } from "node:path";

/** Data lives outside the repo so trading history can never be committed (spec §5). */
export function resolveDataDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
): string {
  if (env.TJ_DATA_DIR) return env.TJ_DATA_DIR;
  if (platform === "win32") {
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "trading-journal");
  }
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "trading-journal");
}

export function dataPaths(dataDir: string) {
  return {
    dataDir,
    dbFile: join(dataDir, "journal.db"),
    backupDir: join(dataDir, "backups"),
    attachmentsDir: join(dataDir, "attachments"),
    secretsFile: join(dataDir, "secrets.json"),
  };
}
```

- [ ] **Step 5: Write the failing app test**

`apps/server/src/app.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, runMigrations } from "@tj/db";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const MIGRATIONS = new URL("../../../packages/db/migrations", import.meta.url).pathname;

const sampleFly = {
  strategy: "iron_fly",
  book: "live",
  underlying: "xyz",
  openedAt: 1788_000_000_000,
  closedAt: 1788_086_400_000,
  netPnl: 512,
  fees: 8,
  legs: [],
  ironFly: {
    bodyPutStrike: 50,
    bodyCallStrike: 50,
    putWingStrike: 45,
    callWingStrike: 58,
    contracts: 4,
    creditPerShare: 3,
  },
};

describe("createApp", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-app-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    app = createApp({ db: openDatabase(file) });
  });

  const post = (body: unknown) =>
    app.request("/api/trades", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify(body),
    });

  it("answers health checks", async () => {
    const res = await app.request("/api/health", { headers: { host: "localhost" } });
    expect(res.status).toBe(200);
  });

  it("creates a trade and returns it with computed metrics", async () => {
    const res = await post(sampleFly);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.underlying).toBe("XYZ");
    expect(body.metrics.maxLoss).toBe(2008);
    expect(body.metrics.returnOnRisk).toBeCloseTo(0.255, 4);
  });

  it("rejects an invalid trade with 400 and a field path", async () => {
    const res = await post({ ...sampleFly, openedAt: -5 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("openedAt");
  });

  it("lists trades and honours the book filter", async () => {
    await post(sampleFly);
    await post({ ...sampleFly, book: "paper" });
    const res = await app.request("/api/trades?book=live", { headers: { host: "localhost" } });
    expect((await res.json()).length).toBe(1);
  });

  it("patches a trade", async () => {
    const created = await (await post(sampleFly)).json();
    const res = await app.request(`/api/trades/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify({ grade: "B", excluded: true, excludeReason: "test" }),
    });
    const body = await res.json();
    expect(body.grade).toBe("B");
    expect(body.excluded).toBe(true);
  });

  it("returns 404 for an unknown trade", async () => {
    const res = await app.request(`/api/trades/${crypto.randomUUID()}`, { headers: { host: "localhost" } });
    expect(res.status).toBe(404);
  });

  it("refuses requests with a foreign Host header", async () => {
    const res = await app.request("/api/health", { headers: { host: "evil.example.com" } });
    expect(res.status).toBe(403);
  });

  it("serves seeded setups and tags", async () => {
    const setups = await (await app.request("/api/setups", { headers: { host: "localhost" } })).json();
    const tags = await (await app.request("/api/tags", { headers: { host: "localhost" } })).json();
    expect(setups.length).toBeGreaterThan(0);
    expect(tags.some((t: { kind: string }) => t.kind === "mistake")).toBe(true);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run apps/server`
Expected: FAIL — cannot resolve `./app.js`.

- [ ] **Step 7: Implement the routes and the app factory**

`apps/server/src/routes/trades.ts`:

```ts
import { zValidator } from "@hono/zod-validator";
import { type IronFlyMetrics, ironFlyMetrics, ironFlyOutcome, newTradeSchema, tradePatchSchema } from "@tj/core";
import { type Db, createTradesRepo, type TradeRecord } from "@tj/db";
import { Hono } from "hono";
import { z } from "zod";

const listQuerySchema = z.object({
  strategy: z.enum(["scalp", "iron_fly"]).optional(),
  book: z.enum(["live", "paper", "missed"]).optional(),
  underlying: z.string().optional(),
  includeExcluded: z.enum(["true", "false"]).optional(),
});

export interface TradeView extends TradeRecord {
  metrics: (IronFlyMetrics & ReturnType<typeof ironFlyOutcome>) | null;
}

/** Metrics are derived on read, so a stored trade and its numbers can never drift apart. */
export function withMetrics(trade: TradeRecord): TradeView {
  const detail = trade.ironFly;
  if (
    !detail ||
    detail.bodyPutStrike == null ||
    detail.bodyCallStrike == null ||
    detail.putWingStrike == null ||
    detail.callWingStrike == null ||
    detail.contracts == null ||
    detail.creditPerShare == null
  ) {
    return { ...trade, metrics: null };
  }
  const metrics = ironFlyMetrics({
    bodyPutStrike: detail.bodyPutStrike,
    bodyCallStrike: detail.bodyCallStrike,
    putWingStrike: detail.putWingStrike,
    callWingStrike: detail.callWingStrike,
    contracts: detail.contracts,
    creditPerShare: detail.creditPerShare,
    fees: trade.fees,
  });
  return { ...trade, metrics: { ...metrics, ...ironFlyOutcome(metrics, trade.netPnl ?? 0) } };
}

export function tradeRoutes(db: Db, now?: () => number) {
  const repo = createTradesRepo(db, now);

  return new Hono()
    .get("/", zValidator("query", listQuerySchema), (c) => {
      const query = c.req.valid("query");
      return c.json(
        repo
          .list({
            strategy: query.strategy,
            book: query.book,
            underlying: query.underlying,
            includeExcluded: query.includeExcluded === "true",
          })
          .map(withMetrics),
      );
    })
    .post("/", zValidator("json", newTradeSchema), (c) => c.json(withMetrics(repo.create(c.req.valid("json"))), 201))
    .get("/:id", (c) => {
      const trade = repo.get(c.req.param("id"));
      return trade ? c.json(withMetrics(trade)) : c.json({ error: "not found" }, 404);
    })
    .patch("/:id", zValidator("json", tradePatchSchema), (c) => {
      const updated = repo.update(c.req.param("id"), c.req.valid("json"));
      return updated ? c.json(withMetrics(updated)) : c.json({ error: "not found" }, 404);
    })
    .delete("/:id", (c) =>
      repo.softDelete(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "not found" }, 404),
    );
}
```

`apps/server/src/routes/taxonomy.ts`:

```ts
import { zValidator } from "@hono/zod-validator";
import { type Db, createTaxonomyRepo } from "@tj/db";
import { Hono } from "hono";
import { z } from "zod";

const newSetupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(500).nullish(),
  strategy: z.enum(["scalp", "iron_fly"]).nullish(),
});

const newTagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["mistake", "emotion"]),
});

export function taxonomyRoutes(db: Db, now?: () => number) {
  const repo = createTaxonomyRepo(db, now);
  repo.seedDefaults();

  const setups = new Hono()
    .get("/", (c) => c.json(repo.listSetups()))
    .post("/", zValidator("json", newSetupSchema), (c) => c.json(repo.createSetup(c.req.valid("json")), 201));

  const tags = new Hono()
    .get("/", (c) => c.json(repo.listTags()))
    .post("/", zValidator("json", newTagSchema), (c) => c.json(repo.createTag(c.req.valid("json")), 201));

  return { setups, tags };
}
```

`apps/server/src/app.ts`:

```ts
import type { Db } from "@tj/db";
import { Hono } from "hono";
import { tradeRoutes } from "./routes/trades.js";
import { taxonomyRoutes } from "./routes/taxonomy.js";

export interface AppDeps {
  db: Db;
  now?: () => number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function createApp(deps: AppDeps) {
  const { setups, tags } = taxonomyRoutes(deps.db, deps.now);

  const app = new Hono()
    // Blocks DNS-rebinding: a page on the internet cannot talk to this server.
    .use("*", async (c, next) => {
      const host = (c.req.header("host") ?? "").split(":")[0] ?? "";
      if (!LOCAL_HOSTS.has(host)) return c.json({ error: "forbidden host" }, 403);
      await next();
    })
    .get("/api/health", (c) => c.json({ ok: true }))
    .route("/api/trades", tradeRoutes(deps.db, deps.now))
    .route("/api/setups", setups)
    .route("/api/tags", tags);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server`
Expected: PASS, 13 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/server
git commit -m "feat(server): hono app factory, data paths and trades API"
```

---

### Task 8: Node entry point that boots against the real data directory

**Files:**
- Create: `apps/server/src/index.ts`, `scripts/start.sh`, `scripts/start.cmd`
- Modify: `package.json` (root scripts), `README.md`

**Interfaces:**
- Consumes: `resolveDataDir`, `dataPaths`, `createApp` (Task 7); `runMigrations`, `openDatabase` (Task 4).
- Produces: a runnable server on `127.0.0.1:4178`; root scripts `pnpm dev:server`, `pnpm start`.

- [ ] **Step 1: Write the entry point**

`apps/server/src/index.ts`:

```ts
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { serve } from "@hono/node-server";
import { openDatabase, runMigrations } from "@tj/db";
import { createApp } from "./app.js";
import { dataPaths, resolveDataDir } from "./config.js";

const MIGRATIONS = new URL("../../../packages/db/migrations", import.meta.url).pathname;
const PORT = Number(process.env.TJ_PORT ?? 4178);

const paths = dataPaths(resolveDataDir(process.env, process.platform, homedir()));
mkdirSync(paths.dataDir, { recursive: true });
mkdirSync(paths.attachmentsDir, { recursive: true });

runMigrations(paths.dbFile, { migrationsFolder: MIGRATIONS, backupDir: paths.backupDir });

const app = createApp({ db: openDatabase(paths.dbFile) });

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  console.log(`Trading journal API on http://127.0.0.1:${PORT}`);
  console.log(`Data directory: ${paths.dataDir}`);
});
```

- [ ] **Step 2: Add root scripts and launch scripts**

Add to the root `package.json` scripts:

```json
"dev:server": "pnpm --filter @tj/server dev",
"dev:web": "pnpm --filter @tj/web dev",
"dev": "pnpm --filter @tj/server dev & pnpm --filter @tj/web dev"
```

`scripts/start.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
pnpm --filter @tj/server start
```

`scripts/start.cmd`:

```bat
@echo off
cd /d "%~dp0.."
call pnpm install --frozen-lockfile || exit /b 1
call pnpm --filter @tj/server start
```

Run: `chmod +x scripts/start.sh`

- [ ] **Step 3: Verify it boots and creates the data directory**

Run:

```bash
TJ_DATA_DIR=/tmp/tj-smoke pnpm dev:server &
sleep 2
curl -s http://127.0.0.1:4178/api/health
curl -s http://127.0.0.1:4178/api/setups | head -c 200
ls /tmp/tj-smoke
kill %1
```

Expected: `{"ok":true}`, a JSON array of seeded setups, and `journal.db` plus `attachments` in `/tmp/tj-smoke`. Confirm no `.db` file appeared inside the repository: `git status --short` shows nothing.

- [ ] **Step 4: Write the README quickstart**

Replace `README.md` with the project title, one-paragraph description, a "Your data stays yours" section naming the data directory per OS and the `TJ_DATA_DIR` override, and a quickstart:

```markdown
## Quickstart

    pnpm install
    pnpm dev          # API on http://127.0.0.1:4178, UI on http://127.0.0.1:5173

Linux/macOS: `./scripts/start.sh` · Windows: `scripts\start.cmd`
```

- [ ] **Step 5: Commit**

```bash
git add apps/server scripts package.json README.md
git commit -m "feat(server): boot against the OS data directory"
```

---

### Task 9: Web shell with the Terminal theme

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/theme.css`, `apps/web/src/api.ts`, `apps/web/src/router.tsx`, `apps/web/src/components/Shell.tsx`, `apps/web/src/components/ui.tsx`, `apps/web/src/components/Shell.test.tsx`, `apps/web/vitest.config.ts`

**Interfaces:**
- Consumes: `AppType` from Task 7.
- Produces:
  - `api` — typed Hono RPC client (`hc<AppType>`)
  - `<Shell>` — nav plus outlet; nav items: Dashboard, Journal, Analytics, Iron Flies, Missed, Playbook, Import / Sync, Settings
  - `<Money>`, `<Num>`, `<Chip>`, `<Panel>` primitives from `components/ui.tsx`
  - the route tree in `router.tsx` with `/` and `/journal`

- [ ] **Step 1: Create the package**

`apps/web/package.json`:

```json
{
  "name": "@tj/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": {
    "@tanstack/react-query": "^5.103.2",
    "@tanstack/react-router": "^1.170.38",
    "@tj/core": "workspace:*",
    "@tj/server": "workspace:*",
    "hono": "^4.13.8",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^5.0.0",
    "jsdom": "^26.0.0",
    "tailwindcss": "^4.3.3",
    "vite": "^8.3.0"
  }
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing shell test**

`apps/web/src/components/Shell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Shell } from "./Shell.js";

describe("Shell", () => {
  it("renders every primary nav destination", () => {
    render(
      <Shell activePath="/journal">
        <p>content</p>
      </Shell>,
    );
    for (const label of ["Dashboard", "Journal", "Analytics", "Iron Flies", "Missed", "Playbook", "Import / Sync", "Settings"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("marks the active destination", () => {
    render(
      <Shell activePath="/journal">
        <p>content</p>
      </Shell>,
    );
    expect(screen.getByText("Journal").getAttribute("aria-current")).toBe("page");
  });
});
```

`apps/web/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: false },
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run apps/web`
Expected: FAIL — cannot resolve `./Shell.js`.

- [ ] **Step 4: Write the theme and the shell**

`apps/web/src/theme.css`:

```css
@import "tailwindcss";

@theme {
  --color-bg: #0b0e14;
  --color-panel: #131722;
  --color-line: #1f2430;
  --color-fg: #d1d4dc;
  --color-muted: #6b7385;
  --color-accent: #2962ff;
  --color-up: #26a69a;
  --color-down: #ef5350;
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --radius-sm: 3px;
}

html,
body,
#root {
  height: 100%;
}
body {
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-sans);
  font-size: 13px;
}
/* Numbers are always tabular and monospaced, so columns line up. */
.num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
```

`apps/web/src/components/Shell.tsx`:

```tsx
import type { ReactNode } from "react";

const NAV = [
  { label: "Dashboard", path: "/" },
  { label: "Journal", path: "/journal" },
  { label: "Analytics", path: "/analytics" },
  { label: "Iron Flies", path: "/iron-flies" },
  { label: "Missed", path: "/missed" },
  { label: "Playbook", path: "/playbook" },
  { label: "Import / Sync", path: "/import" },
  { label: "Settings", path: "/settings" },
];

export function Shell({ activePath, children }: { activePath: string; children: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="w-44 shrink-0 border-r border-line bg-[#0e1118] p-3">
        <div className="mb-4 flex items-center gap-2 px-1 font-semibold tracking-tight">
          <span className="inline-block h-4 w-4 rounded-[2px] bg-accent" />
          TRADEJRNL
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = item.path === activePath;
            return (
              <a
                key={item.path}
                href={item.path}
                aria-current={active ? "page" : undefined}
                className={`rounded-sm px-2 py-1.5 ${active ? "bg-[#1c2130] text-fg" : "text-muted hover:text-fg"}`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-4">{children}</main>
    </div>
  );
}
```

`apps/web/src/components/ui.tsx`:

```tsx
import type { ReactNode } from "react";

export function Panel({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-sm border border-line bg-panel p-2.5">
      {(title || right) && (
        <header className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted">
          <span>{title}</span>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/** Dollars, coloured by sign, always monospaced. */
export function Money({ value, className = "" }: { value: number | null; className?: string }) {
  if (value == null) return <span className={`num text-muted ${className}`}>—</span>;
  const tone = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-fg";
  const formatted = value.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return <span className={`num ${tone} ${className}`}>{value > 0 ? `+${formatted}` : formatted}</span>;
}

export function Pct({ value }: { value: number | null }) {
  if (value == null) return <span className="num text-muted">—</span>;
  const tone = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-fg";
  return <span className={`num ${tone}`}>{`${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`}</span>;
}

const CHIP_TONES: Record<string, string> = {
  iron_fly: "bg-[#7e57c22a] text-[#b39ddb]",
  scalp: "bg-[#ff980022] text-[#ffb74d]",
  live: "bg-[#26a69a22] text-up",
  paper: "bg-[#2962ff22] text-[#82a8ff]",
  missed: "bg-[#6b738522] text-[#9aa3b5]",
  excluded: "border border-dashed border-muted text-muted",
  default: "bg-[#1c2130] text-[#9aa3b5]",
};

export function Chip({ tone = "default", children }: { tone?: string; children: ReactNode }) {
  return (
    <span className={`rounded-[2px] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${CHIP_TONES[tone] ?? CHIP_TONES.default}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run apps/web`
Expected: PASS, 2 tests.

- [ ] **Step 6: Wire Vite, the API client and the router**

`apps/web/vite.config.ts`:

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:4178" } },
  build: { outDir: "dist" },
});
```

`apps/web/src/api.ts`:

```ts
import type { AppType } from "@tj/server";
import { hc } from "hono/client";

/** Same-origin in production; Vite proxies /api to the server in development. */
export const api = hc<AppType>("/");
export type TradeView = Awaited<ReturnType<Awaited<ReturnType<typeof api.api.trades.$get>>["json"]>>[number];
```

`apps/web/index.html` loads `/src/main.tsx` and the Google Fonts link for Inter and JetBrains Mono.

`apps/web/src/main.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router.js";
import "./theme.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

`apps/web/src/router.tsx` defines a root route rendering `<Shell activePath={location.pathname}>` around `<Outlet />`, an index route showing a placeholder Dashboard heading, and a `/journal` route that Task 10 fills in.

- [ ] **Step 7: Verify the dev server renders**

Run: `pnpm dev:server & pnpm dev:web`
Open `http://127.0.0.1:5173`. Expected: dark shell, left nav, no console errors. Stop both.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): terminal-themed app shell and typed API client"
```

---

### Task 10: Journal list page

**Files:**
- Create: `apps/web/src/routes/Journal.tsx`, `apps/web/src/routes/Journal.test.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Consumes: `api`, `TradeView` (Task 9); `Panel`, `Money`, `Pct`, `Chip` (Task 9).
- Produces: `<Journal>`; `useTrades(filter: { strategy?: string; book?: string; includeExcluded?: boolean })` exported from the same file for reuse by later plans.

- [ ] **Step 1: Write the failing test**

`apps/web/src/routes/Journal.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Journal } from "./Journal.js";

const trade = {
  id: "t1",
  strategy: "iron_fly",
  book: "live",
  underlying: "XYZ",
  underlyingName: "XYZ Industries",
  structureLabel: "Short Iron Butterfly",
  openedAt: 1788_000_000_000,
  closedAt: 1788_086_400_000,
  netPnl: 512,
  fees: 8,
  grade: "B",
  excluded: false,
  legs: [],
  ironFly: null,
  tagIds: [],
  metrics: { maxLoss: 2008, returnOnRisk: 0.255, pctOfMaxProfit: 0.4295, pnlPctOfCost: 0.4295 },
};

function renderJournal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Journal />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Journal", () => {
  it("lists trades with P&L and return on risk", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([trade]), { headers: { "content-type": "application/json" } })));
    renderJournal();
    await waitFor(() => expect(screen.getByText("XYZ")).toBeTruthy());
    expect(screen.getByText("+$512.00")).toBeTruthy();
    expect(screen.getByText("+25.50%")).toBeTruthy();
  });

  it("shows an empty state when there are no trades", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } })));
    renderJournal();
    await waitFor(() => expect(screen.getByText(/no trades yet/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/src/routes/Journal.test.tsx`
Expected: FAIL — cannot resolve `./Journal.js`.

- [ ] **Step 3: Implement the page**

`apps/web/src/routes/Journal.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type TradeView } from "../api.js";
import { Chip, Money, Panel, Pct } from "../components/ui.js";

export interface JournalFilter {
  strategy?: "scalp" | "iron_fly";
  book?: "live" | "paper" | "missed";
  includeExcluded?: boolean;
}

export function useTrades(filter: JournalFilter) {
  return useQuery({
    queryKey: ["trades", filter],
    queryFn: async (): Promise<TradeView[]> => {
      const res = await api.api.trades.$get({
        query: {
          strategy: filter.strategy,
          book: filter.book,
          includeExcluded: filter.includeExcluded ? "true" : undefined,
        },
      });
      if (!res.ok) throw new Error(`list trades failed: ${res.status}`);
      return res.json();
    },
  });
}

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function Journal() {
  const [filter, setFilter] = useState<JournalFilter>({});
  const { data, isLoading, error } = useTrades(filter);

  const toggleBook = (book: JournalFilter["book"]) =>
    setFilter((f) => ({ ...f, book: f.book === book ? undefined : book }));

  return (
    <Panel
      title="Journal"
      right={
        <span className="flex gap-1">
          {(["live", "paper", "missed"] as const).map((book) => (
            <button
              key={book}
              type="button"
              onClick={() => toggleBook(book)}
              className={`rounded-[2px] border px-2 py-0.5 uppercase ${
                filter.book === book ? "border-accent bg-[#2962ff1a] text-fg" : "border-line text-muted"
              }`}
            >
              {book}
            </button>
          ))}
        </span>
      }
    >
      {isLoading && <p className="text-muted">Loading…</p>}
      {error && <p className="text-down">Could not load trades: {String(error)}</p>}
      {data?.length === 0 && <p className="text-muted">No trades yet. Add one from Iron Flies → New trade.</p>}
      {data && data.length > 0 && (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-muted">
              <th className="py-1 text-left font-medium">Opened</th>
              <th className="text-left font-medium">Symbol</th>
              <th className="text-left font-medium">Strategy</th>
              <th className="text-left font-medium">Book</th>
              <th className="text-right font-medium">Net P&L</th>
              <th className="text-right font-medium">Return on risk</th>
              <th className="text-right font-medium">Grade</th>
            </tr>
          </thead>
          <tbody>
            {data.map((trade) => (
              <tr key={trade.id} className="border-t border-line">
                <td className="num py-1 text-muted">{ET.format(new Date(trade.openedAt))}</td>
                <td>
                  <a className="text-fg hover:text-[#82a8ff]" href={`/trades/${trade.id}`}>
                    {trade.underlying}
                  </a>
                </td>
                <td>
                  <Chip tone={trade.strategy}>{trade.strategy === "iron_fly" ? "IRON FLY" : "SCALP"}</Chip>
                </td>
                <td>
                  <Chip tone={trade.book}>{trade.book.toUpperCase()}</Chip>{" "}
                  {trade.excluded && <Chip tone="excluded">EXCLUDED</Chip>}
                </td>
                <td className="text-right">
                  <Money value={trade.netPnl} />
                </td>
                <td className="text-right">
                  <Pct value={trade.metrics?.returnOnRisk ?? null} />
                </td>
                <td className="num text-right text-muted">{trade.grade ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
```

Point the `/journal` route in `router.tsx` at this component.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): journal list with book filters"
```

---

### Task 11: Manual iron fly entry form

**Files:**
- Create: `apps/web/src/routes/NewIronFly.tsx`, `apps/web/src/routes/NewIronFly.test.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Consumes: `api` (Task 9); `ironFlyMetrics`, `ironFlyOutcome` from `@tj/core` (Task 3).
- Produces: `<NewIronFly>` at route `/iron-flies/new`; on success it navigates to `/trades/:id`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/routes/NewIronFly.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewIronFly } from "./NewIronFly.js";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NewIronFly onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return { onCreated };
}

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("NewIronFly", () => {
  it("previews metrics live as the structure is typed", () => {
    setup();
    fill("Underlying", "XYZ");
    fill("Body strike", "50");
    fill("Put wing", "45");
    fill("Call wing", "58");
    fill("Contracts", "4");
    fill("Credit per share", "3.00");
    fill("Fees", "8.00");
    expect(screen.getByTestId("preview-max-loss").textContent).toContain("2,008.00");
    expect(screen.getByTestId("preview-breakevens").textContent).toContain("47.02");
    expect(screen.getByTestId("preview-broken").textContent).toContain("broken");
  });

  it("posts the trade and reports the new id", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "new-id" }), { status: 201, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { onCreated } = setup();
    fill("Underlying", "XYZ");
    fill("Body strike", "50");
    fill("Put wing", "45");
    fill("Call wing", "58");
    fill("Contracts", "4");
    fill("Credit per share", "3.00");
    fill("Net P&L", "512.00");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-id"));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.strategy).toBe("iron_fly");
    expect(body.ironFly.callWingStrike).toBe(58);
    expect(body.legs).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/src/routes/NewIronFly.test.tsx`
Expected: FAIL — cannot resolve `./NewIronFly.js`.

- [ ] **Step 3: Implement the form**

`apps/web/src/routes/NewIronFly.tsx`:

```tsx
import { ironFlyMetrics } from "@tj/core";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api.js";
import { Panel } from "../components/ui.js";

interface FormState {
  underlying: string;
  underlyingName: string;
  book: "live" | "paper";
  openedAt: string;
  closedAt: string;
  bodyStrike: string;
  putWing: string;
  callWing: string;
  expiry: string;
  contracts: string;
  creditPerShare: string;
  fees: string;
  netPnl: string;
  notes: string;
}

const EMPTY: FormState = {
  underlying: "",
  underlyingName: "",
  book: "live",
  openedAt: "",
  closedAt: "",
  bodyStrike: "",
  putWing: "",
  callWing: "",
  expiry: "",
  contracts: "",
  creditPerShare: "",
  fees: "0",
  netPnl: "",
  notes: "",
};

const num = (value: string): number => (value.trim() === "" ? Number.NaN : Number(value));
const ms = (value: string): number => (value ? new Date(value).getTime() : Number.NaN);

/** The four contracts of a short iron butterfly, derived from the structure fields. */
function buildLegs(form: FormState) {
  const size = num(form.contracts);
  const body = num(form.bodyStrike);
  return [
    { right: "C" as const, strike: body, expiry: form.expiry, quantity: -size, multiplier: 100, openPrice: 0, closePrice: null },
    { right: "P" as const, strike: body, expiry: form.expiry, quantity: -size, multiplier: 100, openPrice: 0, closePrice: null },
    { right: "C" as const, strike: num(form.callWing), expiry: form.expiry, quantity: size, multiplier: 100, openPrice: 0, closePrice: null },
    { right: "P" as const, strike: num(form.putWing), expiry: form.expiry, quantity: size, multiplier: 100, openPrice: 0, closePrice: null },
  ];
}

export function NewIronFly({ onCreated }: { onCreated?: (id: string) => void }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const preview = useMemo(() => {
    const input = {
      bodyPutStrike: num(form.bodyStrike),
      bodyCallStrike: num(form.bodyStrike),
      putWingStrike: num(form.putWing),
      callWingStrike: num(form.callWing),
      contracts: num(form.contracts),
      creditPerShare: num(form.creditPerShare),
      fees: Number.isNaN(num(form.fees)) ? 0 : num(form.fees),
    };
    return Object.values(input).some(Number.isNaN) ? null : ironFlyMetrics(input);
  }, [form]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.api.trades.$post({
        json: {
          strategy: "iron_fly",
          book: form.book,
          underlying: form.underlying,
          underlyingName: form.underlyingName || null,
          structureLabel: "Short Iron Butterfly",
          openedAt: Number.isNaN(ms(form.openedAt)) ? Date.now() : ms(form.openedAt),
          closedAt: Number.isNaN(ms(form.closedAt)) ? null : ms(form.closedAt),
          netPnl: Number.isNaN(num(form.netPnl)) ? null : num(form.netPnl),
          fees: Number.isNaN(num(form.fees)) ? 0 : num(form.fees),
          notes: form.notes || null,
          source: "manual",
          legs: buildLegs(form),
          ironFly: {
            bodyPutStrike: num(form.bodyStrike),
            bodyCallStrike: num(form.bodyStrike),
            putWingStrike: num(form.putWing),
            callWingStrike: num(form.callWing),
            contracts: num(form.contracts),
            creditPerShare: num(form.creditPerShare),
            netCost: null,
          },
        },
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      return (await res.json()) as { id: string };
    },
    onSuccess: (created) => onCreated?.(created.id),
  });

  const field = (label: string, key: keyof FormState, type = "text") => (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-muted">
      {label}
      <input
        aria-label={label}
        type={type}
        value={form[key]}
        onChange={set(key)}
        className="num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg outline-none focus:border-accent"
      />
    </label>
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
      <Panel title="New iron fly">
        <div className="grid grid-cols-3 gap-2">
          {field("Underlying", "underlying")}
          {field("Company", "underlyingName")}
          {field("Expiry", "expiry", "date")}
          {field("Opened", "openedAt", "datetime-local")}
          {field("Closed", "closedAt", "datetime-local")}
          {field("Contracts", "contracts", "number")}
          {field("Body strike", "bodyStrike", "number")}
          {field("Put wing", "putWing", "number")}
          {field("Call wing", "callWing", "number")}
          {field("Credit per share", "creditPerShare", "number")}
          {field("Fees", "fees", "number")}
          {field("Net P&L", "netPnl", "number")}
        </div>
        <label className="mt-2 flex flex-col gap-1 text-[10px] uppercase tracking-wider text-muted">
          Notes
          <textarea
            aria-label="Notes"
            value={form.notes}
            onChange={set("notes")}
            className="min-h-16 rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="mt-3 rounded-sm bg-accent px-3 py-1.5 text-white disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save trade"}
        </button>
        {save.error && <p className="mt-2 text-down">{String(save.error)}</p>}
      </Panel>

      <Panel title="Live preview">
        {!preview && <p className="text-muted">Fill in the structure to see the risk.</p>}
        {preview && (
          <dl className="grid gap-1">
            <Row label="Put wing / call wing">
              <span data-testid="preview-broken">
                {preview.putWingWidth} / {preview.callWingWidth} {preview.isBrokenWing ? "· broken" : ""}
              </span>
            </Row>
            <Row label="Max profit">{preview.maxProfit.toLocaleString("en-US", { style: "currency", currency: "USD" })}</Row>
            <Row label="Max loss">
              <span data-testid="preview-max-loss">
                {preview.maxLoss.toLocaleString("en-US", { style: "currency", currency: "USD" })} ({preview.riskySide} side)
              </span>
            </Row>
            <Row label="Breakevens">
              <span data-testid="preview-breakevens">
                {preview.breakevenLow} / {preview.breakevenHigh}
              </span>
            </Row>
          </dl>
        )}
      </Panel>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}
```

Add the `/iron-flies/new` route in `router.tsx`, passing `onCreated={(id) => router.navigate({ to: `/trades/${id}` })}`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): manual iron fly entry with live risk preview"
```

---

### Task 12: Trade detail page with collapsed legs and inline review

**Files:**
- Create: `apps/web/src/routes/TradeDetail.tsx`, `apps/web/src/routes/TradeDetail.test.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Consumes: `api`, `TradeView`, `Panel`, `Money`, `Pct`, `Chip`.
- Produces: `<TradeDetail tradeId={string} />` at `/trades/:id`, covering the tile row, the collapsed legs table, grade buttons, the exclude switch and notes.

- [ ] **Step 1: Write the failing test**

`apps/web/src/routes/TradeDetail.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradeDetail } from "./TradeDetail.js";

const trade = {
  id: "t1",
  strategy: "iron_fly",
  book: "live",
  underlying: "XYZ",
  underlyingName: "XYZ Industries",
  structureLabel: "Short Iron Butterfly",
  openedAt: 1788_000_000_000,
  closedAt: 1788_086_400_000,
  netPnl: 512,
  fees: 8,
  notes: "crush paid",
  grade: null,
  excluded: false,
  excludeReason: null,
  tagIds: [],
  ironFly: { bodyPutStrike: 50, bodyCallStrike: 50, putWingStrike: 45, callWingStrike: 58, contracts: 4, creditPerShare: 3, sourceNotes: null },
  legs: [
    { id: "l1", right: "C", strike: 50, expiry: "2026-10-16", quantity: -4, multiplier: 100, openPrice: 2.1, closePrice: 1 },
    { id: "l2", right: "P", strike: 50, expiry: "2026-10-16", quantity: -4, multiplier: 100, openPrice: 1.6, closePrice: 0.8 },
  ],
  metrics: {
    putWingWidth: 5,
    callWingWidth: 8,
    isBrokenWing: true,
    maxProfit: 1192,
    putSideRisk: 808,
    callSideRisk: 2008,
    maxLoss: 2008,
    riskySide: "call",
    breakevenLow: 47.02,
    breakevenHigh: 52.98,
    returnOnRisk: 0.255,
    pctOfMaxProfit: 0.4295,
    pnlPctOfCost: 0.4295,
  },
};

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TradeDetail tradeId="t1" />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("TradeDetail", () => {
  it("shows the headline metrics and marks the broken wing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(trade), { headers: { "content-type": "application/json" } })));
    renderDetail();
    await waitFor(() => expect(screen.getByText("XYZ Industries")).toBeTruthy());
    expect(screen.getByTestId("tile-max-loss").textContent).toContain("2,008.00");
    expect(screen.getByTestId("tile-structure").textContent).toContain("broken");
    expect(screen.getByTestId("tile-breakevens").textContent).toContain("47.02");
  });

  it("keeps legs collapsed until the expander is opened", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(trade), { headers: { "content-type": "application/json" } })));
    renderDetail();
    await waitFor(() => expect(screen.getByText(/legs \(2\)/i)).toBeTruthy());
    expect(screen.getByTestId("legs-details").hasAttribute("open")).toBe(false);
  });

  it("patches the grade when a grade button is pressed", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(trade), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderDetail();
    await waitFor(() => expect(screen.getByRole("button", { name: "B" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((call) => String(call[1]?.method) === "PATCH");
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch?.[1]?.body)).grade).toBe("B");
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/src/routes/TradeDetail.test.tsx`
Expected: FAIL — cannot resolve `./TradeDetail.js`.

- [ ] **Step 3: Implement the page**

`apps/web/src/routes/TradeDetail.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type TradeView } from "../api.js";
import { Chip, Money, Panel, Pct } from "../components/ui.js";

const GRADES = ["A", "B", "C", "D", "F"] as const;
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function TradeDetail({ tradeId }: { tradeId: string }) {
  const queryClient = useQueryClient();

  const { data: trade, isLoading } = useQuery({
    queryKey: ["trade", tradeId],
    queryFn: async (): Promise<TradeView> => {
      const res = await api.api.trades[":id"].$get({ param: { id: tradeId } });
      if (!res.ok) throw new Error(`load failed: ${res.status}`);
      return res.json();
    },
  });

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await api.api.trades[":id"].$patch({ param: { id: tradeId }, json: body });
      if (!res.ok) throw new Error(`patch failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trade", tradeId] }),
  });

  if (isLoading || !trade) return <p className="text-muted">Loading…</p>;
  const m = trade.metrics;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="num text-[16px] font-semibold">{trade.underlying}</h1>
        <span className="text-muted">{trade.underlyingName}</span>
        <Chip tone={trade.strategy}>{trade.structureLabel ?? "IRON FLY"}</Chip>
        <Chip tone={trade.book}>{trade.book.toUpperCase()}</Chip>
        {trade.excluded && <Chip tone="excluded">EXCLUDED</Chip>}
        <span className="ml-auto text-[18px]">
          <Money value={trade.netPnl} />
        </span>
        <span className="text-[18px]">
          <Pct value={m?.pnlPctOfCost ?? null} />
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label="Structure" testId="tile-structure">
          {m ? `${trade.ironFly?.putWingStrike} / ${trade.ironFly?.bodyPutStrike} / ${trade.ironFly?.callWingStrike}` : "—"}
          <small className="mt-1 block text-[10px] text-muted">
            put wing {m?.putWingWidth} · call wing {m?.callWingWidth} {m?.isBrokenWing ? "· broken" : ""}
          </small>
        </Tile>
        <Tile label="Max profit">{m ? usd(m.maxProfit) : "—"}</Tile>
        <Tile label="Max loss" testId="tile-max-loss">
          {m ? usd(m.maxLoss) : "—"}
          <small className="mt-1 block text-[10px] text-muted">
            {m ? `${m.riskySide} side · other side ${usd(m.riskySide === "call" ? m.putSideRisk : m.callSideRisk)}` : ""}
          </small>
        </Tile>
        <Tile label="Return on risk">{m ? <Pct value={m.returnOnRisk} /> : "—"}</Tile>
        <Tile label="Breakevens" testId="tile-breakevens">
          {m ? `${m.breakevenLow} / ${m.breakevenHigh}` : "—"}
        </Tile>
        <Tile label="Implied move" empty={trade.ironFly?.impliedMovePct == null}>
          {trade.ironFly?.impliedMovePct != null ? `${trade.ironFly.impliedMovePct}%` : "— add"}
        </Tile>
        <Tile label="Actual move" empty={trade.ironFly?.actualMovePct == null}>
          {trade.ironFly?.actualMovePct != null ? `${trade.ironFly.actualMovePct}%` : "— add"}
        </Tile>
        <Tile label="IV before → after" empty={trade.ironFly?.ivBefore == null}>
          {trade.ironFly?.ivBefore != null ? `${trade.ironFly.ivBefore}% → ${trade.ironFly.ivAfter ?? "—"}%` : "— add"}
        </Tile>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
        <Panel>
          <details data-testid="legs-details">
            <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted">
              Legs ({trade.legs.length})
            </summary>
            <table className="num mt-2 w-full border-collapse text-[11px]">
              <thead className="text-[9px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="text-left font-medium">Side</th>
                  <th className="text-left font-medium">Type</th>
                  <th className="text-left font-medium">Strike</th>
                  <th className="text-left font-medium">Exp</th>
                  <th className="text-right font-medium">Size</th>
                  <th className="text-right font-medium">Open</th>
                  <th className="text-right font-medium">Close</th>
                </tr>
              </thead>
              <tbody>
                {trade.legs.map((leg) => (
                  <tr key={leg.id} className="border-t border-line">
                    <td className={leg.quantity < 0 ? "text-down" : "text-up"}>{leg.quantity < 0 ? "SHORT" : "LONG"}</td>
                    <td>{leg.right === "C" ? "Call" : "Put"}</td>
                    <td>{leg.strike.toFixed(2)}</td>
                    <td>{leg.expiry.slice(5)}</td>
                    <td className="text-right">{leg.quantity}</td>
                    <td className="text-right">{leg.openPrice.toFixed(2)}</td>
                    <td className="text-right">{leg.closePrice?.toFixed(2) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Panel>

        <Panel title="Review">
          <div className="mb-2 flex gap-1">
            {GRADES.map((grade) => (
              <button
                key={grade}
                type="button"
                onClick={() => patch.mutate({ grade })}
                className={`num w-6 rounded-[2px] border py-0.5 ${
                  trade.grade === grade ? "border-accent bg-accent text-white" : "border-line text-muted"
                }`}
              >
                {grade}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-muted">
            <input
              type="checkbox"
              checked={trade.excluded}
              onChange={(e) => patch.mutate({ excluded: e.target.checked })}
            />
            Exclude from stats
          </label>
          <textarea
            aria-label="Notes"
            defaultValue={trade.notes ?? ""}
            onBlur={(e) => patch.mutate({ notes: e.target.value })}
            className="mt-2 min-h-20 w-full rounded-sm border border-line bg-[#0e1118] p-2 text-fg outline-none focus:border-accent"
          />
        </Panel>
      </div>
    </div>
  );
}

function Tile({
  label,
  children,
  testId,
  empty = false,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
  empty?: boolean;
}) {
  return (
    <div className={`rounded-sm border bg-panel p-2 ${empty ? "border-dashed border-line" : "border-line"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`num mt-1 text-[15px] font-semibold ${empty ? "text-[#4b5263]" : ""}`} data-testid={testId}>
        {children}
      </div>
    </div>
  );
}
```

Add the `/trades/$id` route in `router.tsx`, rendering `<TradeDetail tradeId={params.id} />`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): trade detail with collapsed legs and inline review"
```

---

### Task 13: One-process serve and an end-to-end smoke check

**Files:**
- Modify: `apps/server/src/index.ts`, `apps/server/package.json`, `package.json`, `README.md`
- Create: `apps/server/src/static.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `pnpm start` serving API and built UI from `http://127.0.0.1:4178`; `createApp` gains an optional `webDir` that serves the built SPA with history fallback.

- [ ] **Step 1: Write the failing test**

`apps/server/src/static.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, runMigrations } from "@tj/db";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const MIGRATIONS = new URL("../../../packages/db/migrations", import.meta.url).pathname;

function appWithWeb() {
  const root = mkdtempSync(join(tmpdir(), "tj-static-"));
  const webDir = join(root, "web");
  mkdirSync(webDir, { recursive: true });
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>Journal</title>");
  const file = join(root, "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  return createApp({ db: openDatabase(file), webDir });
}

describe("static hosting", () => {
  it("serves index.html at the root", async () => {
    const res = await appWithWeb().request("/", { headers: { host: "localhost" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Journal");
  });

  it("falls back to index.html for client-side routes", async () => {
    const res = await appWithWeb().request("/trades/abc", { headers: { host: "localhost" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Journal");
  });

  it("still 404s unknown API routes rather than serving HTML", async () => {
    const res = await appWithWeb().request("/api/nope", { headers: { host: "localhost" } });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/server/src/static.test.ts`
Expected: FAIL — `webDir` is not part of `AppDeps`.

- [ ] **Step 3: Serve the built SPA from the app**

In `apps/server/src/app.ts`, extend `AppDeps` with `webDir?: string` and append, after the API routes:

```ts
  if (deps.webDir) {
    const { serveStatic } = await import("@hono/node-server/serve-static");
    const indexHtml = join(deps.webDir, "index.html");
    app
      .get("/api/*", (c) => c.json({ error: "not found" }, 404))
      .use("/*", serveStatic({ root: deps.webDir }))
      // Client-side routes such as /trades/:id must return the SPA shell.
      .get("*", (c) => c.html(readFileSync(indexHtml, "utf8")));
  }
```

Because of the dynamic import, make `createApp` async or hoist the import to the top of the file; hoisting is simpler — import `serveStatic` and `readFileSync`/`join` at the top and keep `createApp` synchronous.

- [ ] **Step 4: Pass the built web directory from the entry point**

In `apps/server/src/index.ts`, resolve `webDir` as `new URL("../../web/dist", import.meta.url).pathname` and pass it only when that directory exists, so `pnpm dev:server` still works before the UI is built.

Add to the root `package.json`:

```json
"build": "pnpm --filter @tj/web build",
"start": "pnpm build && pnpm --filter @tj/server start"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run`
Expected: PASS across all packages (Task 1–13 suites).

- [ ] **Step 6: Verify the real thing end to end**

Run:

```bash
TJ_DATA_DIR=/tmp/tj-e2e pnpm start
```

In the browser at `http://127.0.0.1:4178`: go to Iron Flies → New trade, enter the sample fly (XYZ, body 50, wings 45 and 58, 4 contracts, credit 3.00, fees 8.00, net P&L 512.00), save it, and confirm on the detail page that max loss reads **$2,008.00 (call side)**, breakevens read **47.02 / 52.98**, return on risk reads **+25.50%**, and the legs table stays collapsed until opened. Grade it B, tick Exclude from stats, reload, and confirm both stuck. Then `git status --short` — no data files may appear.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: serve UI and API from one process"
```

---

## Self-Review

**Spec coverage for Phase 1a (spec §13, items 1–4 and 8):**

| Spec requirement | Task |
|---|---|
| Monorepo scaffold, Biome, Vitest, CI matrix, README, MIT licence | 1 |
| Data directory, backups | 4, 7, 8 |
| Drizzle schema, migrations, repositories | 4, 5, 6 |
| Sync columns, soft delete, `editedAt` semantics (§12) | 4, 5 |
| App shell in the Terminal theme, nav | 9 |
| Journal grid and trade detail | 10, 12 |
| Manual iron fly entry | 11 |
| Exclude flag with reason | 5, 7, 12 |
| Iron fly metrics, independent wings, breakevens, P&L % of cost (§7.3) | 3, 7, 12 |
| Fee derivation from leg cash vs row cost (§7.2b) | 3 |
| Secondary detail behind an expander (§10) | 12 |
| Setups, tags, grades, notes | 6, 7, 12 |
| Loopback binding and Host-header guard (§4) | 7, 8 |

Deferred to later plans, by design: the CSV/paste importer and oQuants extractor (§7.2, §7.2b), the Analytics page (§9), export/merge bundles (§12), and everything in Phases 2 and 3. Attachments are not used in Phase 1a; `attachmentsDir` is created so the layout is fixed from the start.

**Placeholder scan:** no TBDs; every code step carries runnable code; the one prose-only step (Task 9 step 6 router wiring, Task 8 step 4 README) states exactly what to write.

**Type consistency check:** `ironFlyMetrics`/`ironFlyOutcome` field names used in Tasks 7, 11 and 12 match Task 3 (`maxLoss`, `riskySide`, `breakevenLow`, `breakevenHigh`, `returnOnRisk`, `pnlPctOfCost`). `createTradesRepo(db, now)` signature matches its use in Task 7. `TradeRecord.tagIds` is produced in Task 5 and consumed in Tasks 10 and 12. `AppType` is exported in Task 7 and imported in Task 9.
