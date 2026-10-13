# Session Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the intraday chart's stock view, shade pre-market with a faint gold background and after-hours with a faint purple one, as TradingView does, and draw those candles in full colour.

**Architecture:** Core gives each candle a `session` (pre, regular or post) in place of `extended`, and groups runs of pre and post candles into index bands. A small Lightweight Charts series primitive paints those bands full height in `drawBackground`, using the time scale's logical coordinates (±0.5 is a candle's edge). `IntradayChart` attaches it to the candle series and feeds it the bands on each draw, or none on the option view.

**Tech Stack:** TypeScript, React 19, Lightweight Charts 5.2.1 (series primitives), Vitest, jsdom.

**Spec:** `docs/superpowers/specs/2026-10-13-session-backgrounds-design.md`

## Global Constraints

- Pre-market is 04:00–09:30 ET: gold, about 7% opacity. After-hours runs from the regular close (16:00, or 13:00 on a half day) to 20:00: deeper purple, about 9%. Both are tuned at the screenshot check.
- The regular session stays plain. Extended-hours candles are drawn in full colour; the 45% dimming goes.
- Only the stock view gets bands: not the option view (`model.slots` set), not the daily chart.
- European dates in any text: "13 Oct 2026".
- Before each commit: `pnpm format`, `pnpm lint`, `pnpm typecheck`, then the changed test files. Run the full `pnpm test` at the end.

## Review Focus

1. **Switching the same chart from the stock view to the option view.** The bands must clear and not linger behind the option candles. Pinned in Task 3.
2. **A high-DPI screen** (pixel ratio 2). Bands must line up with the candles, not sit at half their x. Pinned in Task 2.
3. **A half day** (the day after Thanksgiving). After-hours starts at 13:00. Pinned in Task 1.
4. **One day's after-hours followed directly by the next day's pre-market.** These are two bands, not one purple band running into gold. Pinned in Task 1.
5. **A band scrolled partly off the left edge.** It still fills from the pane's edge: a negative x is clipped by the canvas, not dropped. Pinned in Task 2.

---

### Task 1: Core: each candle's session, and the bands

**Files:**
- Modify: `packages/core/src/chart.ts:14-17` (the `Candle` type) and `:91` (`aggregate`)
- Modify: `packages/core/src/chart.test.ts` (the `aggregate` and half-day tests that read `extended`)

**Interfaces:**
- Produces:
  - `export type Session = "pre" | "regular" | "post"`;
  - `Candle.session: Session`, replacing `extended`;
  - `export interface SessionBand { from: number; to: number; session: "pre" | "post" }`;
  - `export function sessionBands(candles: readonly Candle[]): SessionBand[]`.
  - All of these are exported from `@tj/core` through `export * from "./chart.js"`.

- [ ] **Step 1: Change the tests to sessions, and add the bands' tests**

In `packages/core/src/chart.test.ts`:
- Add `sessionBands` to the `./chart.js` import.
- Make these replacements:
  - In "builds 3-minute candles…", `extended: true` becomes `session: "pre"`, and both `extended: false` become `session: "regular"`.
  - The test "starts hourly candles at 04:00, 05:00 and so on, marking those that start before 09:30 as extended" becomes "…marking those that start before 09:30 as pre-market", with `toMatchObject({ t: at(DAY, "09:00"), session: "pre" })`.
  - "keeps 1-minute bars as they are, marking the regular session": `expect(candles.map((candle) => candle.session)).toEqual(["regular", "post"]);`
  - Half days, "tints candles from 13:00 as extended hours…": `expect(aggregate(bars, 1).map((candle) => candle.session)).toEqual(["regular", "post"]);`

Append:

```ts
describe("sessionBands", () => {
  const minute = (date: string, hhmm: string) => bar(date, hhmm, 1, 1, 1, 1);

  it("makes one band of each run of pre-market and after-hours candles, by index", () => {
    const candles = aggregate(
      ["09:28", "09:29", "09:30", "15:59", "16:00", "16:01"].map((hhmm) => minute(DAY, hhmm)),
      1,
    );
    expect(sessionBands(candles)).toEqual([
      { from: 0, to: 1, session: "pre" },
      { from: 4, to: 5, session: "post" },
    ]);
  });

  it("has none on a day of regular hours only", () => {
    expect(sessionBands(aggregate([minute(DAY, "09:30"), minute(DAY, "15:59")], 1))).toEqual([]);
  });

  it("splits one day's after-hours from the next day's pre-market", () => {
    const candles = aggregate(
      [minute(DAY, "19:58"), minute(DAY, "19:59"), minute("2026-09-29", "04:00"), minute("2026-09-29", "04:01")],
      1,
    );
    expect(sessionBands(candles)).toEqual([
      { from: 0, to: 1, session: "post" },
      { from: 2, to: 3, session: "pre" },
    ]);
  });

  it("gives each day its own band, even with no regular candle between", () => {
    const candles = aggregate([minute(DAY, "08:00"), minute("2026-09-29", "08:00")], 1);
    expect(sessionBands(candles)).toEqual([
      { from: 0, to: 0, session: "pre" },
      { from: 1, to: 1, session: "pre" },
    ]);
  });

  it("starts a half day's after-hours band at 13:00", () => {
    const FRIDAY = "2026-11-27";
    const candles = aggregate([minute(FRIDAY, "12:59"), minute(FRIDAY, "13:00"), minute(FRIDAY, "13:01")], 1);
    expect(sessionBands(candles)).toEqual([{ from: 1, to: 2, session: "post" }]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @tj/core exec vitest run src/chart.test.ts`
Expected: FAIL. The four session tests read `undefined` for `session`, and `sessionBands is not a function`.

- [ ] **Step 3: Implement**

In `packages/core/src/chart.ts`, replace the `Candle` block:

```ts
/** Where a candle starts: pre-market (04:00–09:30 ET), the regular session, or after-hours (to 20:00). */
export type Session = "pre" | "regular" | "post";

/** A candle on a chart's timeframe, with the session it starts in. */
export interface Candle extends PriceBar {
  session: Session;
}

/** A run of pre-market or after-hours candles on one New York day, by candle index (session-backgrounds spec §2.2). */
export interface SessionBand {
  from: number;
  to: number;
  session: "pre" | "post";
}
```

In `aggregate`, replace `extended: slot < REGULAR_OPEN || slot >= regularClose(date),` with:

```ts
      session: slot < REGULAR_OPEN ? "pre" : slot >= regularClose(date) ? "post" : "regular",
```

After `aggregate`, add:

```ts
/**
 * The chart's pre-market and after-hours backgrounds (session-backgrounds spec §2.2): each run of consecutive candles
 * with the same non-regular session on one New York day, by index. The stock view draws no whitespace, so an index is
 * the candle's place on the chart's time scale.
 */
export function sessionBands(candles: readonly Candle[]): SessionBand[] {
  const bands: SessionBand[] = [];
  candles.forEach((candle, index) => {
    if (candle.session === "regular") return;
    const last = bands.at(-1);
    const previous = candles[index - 1];
    const sameRun =
      last?.to === index - 1 &&
      last.session === candle.session &&
      previous != null &&
      nyClock(previous.t).date === nyClock(candle.t).date;
    if (last && sameRun) last.to = index;
    else bands.push({ from: index, to: index, session: candle.session });
  });
  return bands;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @tj/core exec vitest run src/chart.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add packages/core/src/chart.ts packages/core/src/chart.test.ts
git commit -m "feat(core): each candle's session, and the runs of pre-market and after-hours as bands"
```

`pnpm typecheck` fails at `apps/web/src/chart/IntradayChart.tsx:533` (`candle.extended`). If so, do Task 3's Step 3 removal of the dimming now, as part of this commit: delete the two `extended` lines and return `bar` as is. The chart test that checks the 45% colour then fails until Task 3 rewrites it, so also run `pnpm --filter @tj/web exec vitest run src/chart/charts.test.tsx` and expect exactly that one failure. Ledger it as a ruling.

---

### Task 2: Web: the primitive that paints the bands

**Files:**
- Create: `apps/web/src/chart/sessions.ts`
- Create: `apps/web/src/chart/sessions.test.ts`
- Modify: `apps/web/src/chart/style.ts:12-26` (`COLORS`: remove `upExtended` and `downExtended`, add `preBand` and `postBand`)
- Modify: `apps/web/src/chart/testing.ts` (add `paintedBackground`)

**Interfaces:**
- Consumes: `SessionBand` from `@tj/core` (Task 1).
- Produces:
  - `export class SessionBands implements ISeriesPrimitive<Time>`, with `setBands(bands: readonly SessionBand[]): void`;
  - `COLORS.preBand` and `COLORS.postBand`;
  - in `testing.ts`, `export function paintedBackground(primitive: ISeriesPrimitive<Time>, pixelRatio?: number): Fill[]`, where `Fill = { color: string; x: number; y: number; width: number; height: number }`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/chart/testing.ts`. Merge the type import into the file's existing `import type * as Charts from "lightweight-charts";`:

```ts
import type { ISeriesPrimitive, Time } from "lightweight-charts";

/** One fillRect a primitive's background made, in bitmap pixels. */
export interface Fill {
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a primitive paints in the background layer of the fake's pane, at a pixel ratio. */
export function paintedBackground(primitive: ISeriesPrimitive<Time>, pixelRatio = 1): Fill[] {
  const fills: Fill[] = [];
  const context = {
    fillStyle: "",
    fillRect(x: number, y: number, width: number, height: number) {
      fills.push({ color: String(context.fillStyle), x, y, width, height });
    },
  };
  const target = {
    useBitmapCoordinateSpace: (draw: (scope: unknown) => void) =>
      draw({
        context,
        mediaSize: { width: PANE.width, height: PANE.height },
        bitmapSize: { width: PANE.width * pixelRatio, height: PANE.height * pixelRatio },
        horizontalPixelRatio: pixelRatio,
        verticalPixelRatio: pixelRatio,
      }),
  };
  for (const view of primitive.paneViews?.() ?? []) view.renderer()?.drawBackground?.(target as never);
  return fills;
}
```

Create `apps/web/src/chart/sessions.test.ts`:

```ts
import type { SeriesAttachedParameter, Time } from "lightweight-charts";
import { describe, expect, it, vi } from "vitest";
import { SessionBands } from "./sessions.js";
import { COLORS } from "./style.js";
import { PANE, paintedBackground } from "./testing.js";

/** A time scale with candles 4 px apart, candle 0 centred at x = 0, scrolled by `scroll` px. */
function attach(bands: SessionBands, scroll = 0) {
  const requestUpdate = vi.fn();
  const chart = { timeScale: () => ({ logicalToCoordinate: (logical: number) => logical * 4 - scroll }) };
  bands.attached({ chart, requestUpdate } as unknown as SeriesAttachedParameter<Time>);
  return requestUpdate;
}

describe("SessionBands", () => {
  it("paints each band full height, from its first candle's left edge to its last's right edge", () => {
    const bands = new SessionBands();
    const requestUpdate = attach(bands);
    bands.setBands([
      { from: 2, to: 4, session: "pre" },
      { from: 10, to: 10, session: "post" },
    ]);
    expect(requestUpdate).toHaveBeenCalled();
    expect(paintedBackground(bands)).toEqual([
      { color: COLORS.preBand, x: 6, y: 0, width: 12, height: PANE.height },
      { color: COLORS.postBand, x: 38, y: 0, width: 4, height: PANE.height },
    ]);
  });

  it("lines up on a high-DPI screen, in bitmap pixels", () => {
    const bands = new SessionBands();
    attach(bands);
    bands.setBands([{ from: 2, to: 4, session: "pre" }]);
    expect(paintedBackground(bands, 2)).toEqual([
      { color: COLORS.preBand, x: 12, y: 0, width: 24, height: PANE.height * 2 },
    ]);
  });

  it("still fills a band scrolled partly off the left edge", () => {
    const bands = new SessionBands();
    attach(bands, 20);
    bands.setBands([{ from: 2, to: 9, session: "post" }]);
    expect(paintedBackground(bands)).toEqual([
      { color: COLORS.postBand, x: -14, y: 0, width: 32, height: PANE.height },
    ]);
  });

  it("paints nothing without bands, or before it's attached", () => {
    const bands = new SessionBands();
    bands.setBands([{ from: 0, to: 1, session: "pre" }]);
    expect(paintedBackground(bands)).toEqual([]);
    attach(bands);
    bands.setBands([]);
    expect(paintedBackground(bands)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @tj/web exec vitest run src/chart/sessions.test.ts`
Expected: FAIL: `./sessions.js` can't be resolved.

- [ ] **Step 3: Implement**

In `apps/web/src/chart/style.ts` `COLORS`, delete `upExtended` and `downExtended`, and add:

```ts
  /** Pre-market and after-hours backgrounds on the stock view (session-backgrounds spec §1). */
  preBand: "rgba(255, 193, 7, 0.07)",
  postBand: "rgba(124, 77, 255, 0.09)",
```

Create `apps/web/src/chart/sessions.ts`:

```ts
import type { SessionBand } from "@tj/core";
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  Logical,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import { COLORS } from "./style.js";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type TimeScale = Pick<ReturnType<IChartApi["timeScale"]>, "logicalToCoordinate">;

const FILL = { pre: COLORS.preBand, post: COLORS.postBand } as const;

/**
 * Pre-market in gold and after-hours in purple, behind the candles and the pane's full height (session-backgrounds
 * spec §2.3). A logical index is a candle's centre, so ±0.5 is its edge at any zoom.
 */
export class SessionBands implements ISeriesPrimitive<Time> {
  private bands: readonly SessionBand[] = [];
  private timeScale: TimeScale | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly views: readonly IPrimitivePaneView[] = [
    {
      zOrder: () => "bottom",
      renderer: () => ({ draw: () => {}, drawBackground: (target: Target) => this.paint(target) }),
    },
  ];

  attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.timeScale = chart.timeScale();
    this.requestUpdate = requestUpdate;
  }

  detached(): void {
    this.timeScale = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  setBands(bands: readonly SessionBand[]): void {
    this.bands = bands;
    this.requestUpdate?.();
  }

  private paint(target: Target): void {
    const timeScale = this.timeScale;
    if (!timeScale || this.bands.length === 0) return;
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio }) => {
      for (const band of this.bands) {
        const left = timeScale.logicalToCoordinate((band.from - 0.5) as Logical);
        const right = timeScale.logicalToCoordinate((band.to + 0.5) as Logical);
        if (left == null || right == null) continue;
        const x = Math.round(left * horizontalPixelRatio);
        context.fillStyle = FILL[band.session];
        context.fillRect(x, 0, Math.round(right * horizontalPixelRatio) - x, bitmapSize.height);
      }
    });
  }
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @tj/web exec vitest run src/chart/sessions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add apps/web/src/chart/sessions.ts apps/web/src/chart/sessions.test.ts apps/web/src/chart/style.ts apps/web/src/chart/testing.ts
git commit -m "feat(web): a chart primitive that paints pre-market gold and after-hours purple"
```

If `pnpm typecheck` fails on `COLORS.upExtended` in `IntradayChart.tsx` because Task 1 didn't already remove the dimming, remove it here; see Task 3 Step 3.

---

### Task 3: Web: the intraday chart draws the bands

**Files:**
- Modify: `apps/web/src/chart/IntradayChart.tsx`:
  - `Parts` at `:140` gains `sessions: SessionBands`;
  - the chart's build at `:255-308` attaches it;
  - the draw effect at `:524-541` sets the bands and drops the dimming.
- Modify: `apps/web/src/chart/testing.ts`:
  - each fake series gets `attachPrimitive`, which calls `attached`;
  - `library.primitives` and `resetLibrary`.
- Modify: `apps/web/src/chart/charts.test.tsx`:
  - the first IntradayChart test;
  - a new test in "IntradayChart's option view".

**Interfaces:**
- Consumes: `sessionBands` (Task 1); `SessionBands` and `paintedBackground` (Task 2).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

In `testing.ts`:
- add `primitives: [] as { type: string; primitive: Charts.ISeriesPrimitive<Charts.Time> }[],` to `library`;
- add `library.primitives = [];` to `resetLibrary`.

In `fakeLibrary`'s `createChart`, change `return { addSeries: …, … };` to `const chart = { addSeries: …, … }; return chart;`. In the series handle `addSeries` returns, add:

```ts
          attachPrimitive: (primitive: Charts.ISeriesPrimitive<Charts.Time>) => {
            library.primitives.push({ type: series.type, primitive });
            primitive.attached?.({ chart, requestUpdate: () => {} } as never);
          },
```

The handle's methods need `chart`, so the handle object is created inside `addSeries`, which runs after `chart` exists. The fake time scale's `logicalToCoordinate` (logical × `BAR_PX`) already serves the primitive.

In `charts.test.tsx`:
- import `paintedBackground` from `./testing.js`;
- import `COLORS` from `./style.js`;
- rename the first IntradayChart test to "draws candles in full colour, pre-market and after-hours shaded behind them, with volume, EMAs, VWAP and the four levels";
- replace its `premarket` and `open` lines:

```ts
    // Full colour in every session; the background alone marks pre-market and after-hours.
    expect(drawn.every((candle) => candle.color === undefined)).toBe(true);
    // MODEL: 25 Sep 09:30–16:00 is 130 regular 3m candles, then 28 Sep 04:00–20:00: 110 pre, 130 regular, 80 post.
    const [bands] = library.primitives;
    expect(bands?.type).toBe("Candlestick");
    expect(paintedBackground(bands?.primitive as never)).toEqual([
      { color: COLORS.preBand, x: 129.5 * BAR_PX, y: 0, width: 110 * BAR_PX, height: 400 },
      { color: COLORS.postBand, x: 369.5 * BAR_PX, y: 0, width: 80 * BAR_PX, height: 400 },
    ]);
```

In `describe("IntradayChart's option view")`, add:

```ts
  it("has no session backgrounds, also when the same chart switches over from the stock view", () => {
    const { rerender } = render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} />);
    const bands = library.primitives[0]?.primitive as never;
    expect(paintedBackground(bands)).toHaveLength(2);
    rerender(
      <IntradayChart model={OPTION} show={DEFAULT_PREFS.show} fitKey={0} viewKey="option" markersAtPrice />,
    );
    expect(library.charts).toBe(1);
    expect(paintedBackground(bands)).toEqual([]);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @tj/web exec vitest run src/chart/charts.test.tsx`
Expected: FAIL. Both tests find no primitive (`library.primitives[0]` is undefined).

- [ ] **Step 3: Implement**

In `IntradayChart.tsx`:
- add `import { SessionBands } from "./sessions.js";`;
- add `sessionBands` to the `@tj/core` import;
- add `sessions: SessionBands;` to `interface Parts`.

After `const candles = chart.addSeries(CandlestickSeries, { … });`, add:

```ts
    // Pre-market and after-hours backgrounds behind the candles (session-backgrounds spec §2.3).
    const sessions = new SessionBands();
    candles.attachPrimitive(sessions);
```

Then add `sessions` to the `parts.current = { … }` object.

In the draw effect, replace:

```ts
      if (!candle.extended) return bar;
      const color = candle.c >= candle.o ? COLORS.upExtended : COLORS.downExtended;
      return { ...bar, color, wickColor: color, borderColor: color };
```

with `return bar;`, and simplify the arrow so it returns the bar object directly. After the candles' `setData`, add:

```ts
    // The option view has only regular hours, so no bands (session-backgrounds spec §1).
    chart.sessions.setBands(model.slots ? [] : sessionBands(model.candles));
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @tj/web exec vitest run src/chart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add apps/web/src/chart/IntradayChart.tsx apps/web/src/chart/testing.ts apps/web/src/chart/charts.test.tsx
git commit -m "feat(web): the intraday chart shades pre-market and after-hours, with full-colour candles"
```

---

### Task 4: Screenshot check, docs, full suite

**Files:**
- Modify: `docs/superpowers/specs/2026-10-13-session-backgrounds-design.md` (add §5, the check's results)
- Modify: `docs/superpowers/specs/2026-09-29-trade-chart-design.md:45` (Hours row) and `:259`
- Modify: `README.md:103`
- Modify: `apps/web/src/chart/style.ts`, only if the check tunes the colours

- [ ] **Step 1: Screenshot the demo**
  1. Start `pnpm demo` on its own port: `TJ_PORT=4179`, with `TJ_DEMO_DIR` set to a fresh scratchpad folder.
  2. Follow the visual check recipe: headless Firefox plus puppeteer-core 24 installed in the scratchpad, waiting for Google Fonts first.
  3. Open a demo scalp and screenshot its chart:
     - on 1m and 5m;
     - zoomed out so pre-market, the regular session and after-hours all show;
     - on the option view.
  4. Read the PNGs.
  - Expected: a faint gold wash over 04:00–09:30 and a faint purple one after 16:00, both full height and behind the candles, with edges on the candle boundaries. The candles are in full colour. The option view has no bands.
  - If the washes are too faint or too strong on `#131722`, adjust only the alpha of `COLORS.preBand` and `COLORS.postBand`, rerun `src/chart`, and screenshot again.

- [ ] **Step 2: Docs**
- **Trade-chart spec:**
  - Hours row: "**Full extended hours**, 04:00–20:00 ET; pre-market and after-hours are shaded gold and purple (session-backgrounds spec, 13 Oct 2026)."
  - Line 259: "The premarket candles are lighter." becomes "Pre-market and after-hours are shaded behind full-colour candles (since 13 Oct 2026)."
- **README line 103:** "VWAP, and premarket and prior-day levels" becomes "VWAP, premarket and prior-day levels, and pre-market and after-hours shaded as on TradingView".
- **Session-backgrounds spec:** add "## 5. Check (13 Oct 2026)" with what the screenshots showed and the final colours.

- [ ] **Step 3: Full suite and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A docs README.md apps/web/src/chart/style.ts
git commit -m "docs: the session backgrounds' check, in the specs and README"
git push
```

Expected: the full suite passes, with the Windows-only test skipped.
