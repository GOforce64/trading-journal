import { round2 } from "@tj/core";

/** The two lines a scalp's review draws and drags (scalp-review spec §8). */
export type LevelKind = "stop" | "target";

/** How near, in pixels, a press must land to grab a line (spec §8.3). */
export const GRAB_PX = 6;

/** What the intraday chart reports while the user places or drags the review's lines. */
export interface ChartEditing {
  /** The line the next click on the chart places, if any. */
  placing: LevelKind | null;
  /** A click placed a line here: save it. */
  onPlace(kind: LevelKind, price: number): void;
  /** A dragged line is here now. Nothing is saved yet. */
  onDrag(kind: LevelKind, price: number): void;
  /** The drag ended here: save it. */
  onDrop(kind: LevelKind, price: number): void;
  /** Esc: stop placing, or a dragged line went back. */
  onCancel(): void;
}

/** The line within reach of `y`, the closer one when both are. `toY` answers null for a price off the scale. */
export function nearestLine(
  lines: readonly { id: LevelKind; price: number }[],
  y: number,
  toY: (price: number) => number | null,
): LevelKind | null {
  let best: { id: LevelKind; distance: number } | null = null;
  for (const line of lines) {
    const at = toY(line.price);
    if (at == null) continue;
    const distance = Math.abs(at - y);
    if (distance <= GRAB_PX && (!best || distance < best.distance)) best = { id: line.id, distance };
  }
  return best?.id ?? null;
}

/** The price at height `y`, to the cent. Null off the scale, or at or below zero. */
export function priceAt(y: number, toPrice: (y: number) => number | null): number | null {
  const price = toPrice(y);
  return price == null || !Number.isFinite(price) || price <= 0 ? null : round2(price);
}

/** Whether a point on the chart is on the plot rather than an axis. */
export const inPane = (x: number, y: number, pane: { width: number; height: number }) =>
  x >= 0 && y >= 0 && x < pane.width && y < pane.height;
