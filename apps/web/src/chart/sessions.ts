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
 * spec §2.3). A logical index is a candle's centre, and its edges lie half a bar either side, at any zoom.
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
    // biome-ignore lint/correctness/useHookAtTopLevel: the canvas target's method (fancy-canvas), not a React hook
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio }) => {
      if (!timeScale) return;
      // Lightweight Charts places whole indexes only (a fraction gives 0), so a bar's width comes from two neighbours.
      const centre = (index: number) => timeScale.logicalToCoordinate(index as Logical);
      for (const band of this.bands) {
        const first = centre(band.from);
        const next = centre(band.from + 1);
        const last = centre(band.to);
        if (first == null || next == null || last == null) continue;
        const half = (next - first) / 2;
        const x = Math.round((first - half) * horizontalPixelRatio);
        context.fillStyle = FILL[band.session];
        context.fillRect(x, 0, Math.round((last + half) * horizontalPixelRatio) - x, bitmapSize.height);
      }
    });
  }
}
