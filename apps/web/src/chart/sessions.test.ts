import type { SeriesAttachedParameter, Time } from "lightweight-charts";
import { describe, expect, it, vi } from "vitest";
import { SessionBands } from "./sessions.js";
import { COLORS } from "./style.js";
import { PANE, paintedBackground } from "./testing.js";

/**
 * A time scale with candles 4 px apart, candle 0 centred at x = 0, scrolled by `scroll` px. Like Lightweight Charts, it
 * gives 0 for a fractional logical index.
 */
function attach(bands: SessionBands, scroll = 0) {
  const requestUpdate = vi.fn();
  const logicalToCoordinate = (logical: number) => (Number.isInteger(logical) ? logical * 4 - scroll : 0);
  const chart = { timeScale: () => ({ logicalToCoordinate }) };
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
