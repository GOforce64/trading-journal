import { round2 } from "@tj/core";

/**
 * A draggable line's id (scalp-R spec §9.3): "stop", or "t1", "t2"… for the targets, in the order the trade
 * reaches them.
 */
export type LineId = string;

/** How near, in pixels, a press must land to grab a line (scalp-review spec §8.3). */
export const GRAB_PX = 6;

/** What the intraday chart reports while the user places or drags the review's lines. */
export interface ChartEditing {
  /** The line the next click on the chart places, if any. */
  placing: LineId | null;
  /** A click placed a line here: save it. */
  onPlace(id: LineId, price: number): void;
  /** A dragged line is here now. Nothing is saved yet. */
  onDrag(id: LineId, price: number): void;
  /** The drag ended here: save it. */
  onDrop(id: LineId, price: number): void;
  /** Esc: stop placing, or a dragged line went back. */
  onCancel(): void;
}

/** How the placing hint names a line: "the stop", or "T2". */
export const lineName = (id: LineId): string => (id === "stop" ? "the stop" : id.toUpperCase());

/** The line within reach of `y`, the closer one when both are. `toY` answers null for a price off the scale. */
export function nearestLine(
  lines: readonly { id: LineId; price: number }[],
  y: number,
  toY: (price: number) => number | null,
): LineId | null {
  let best: { id: LineId; distance: number } | null = null;
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
