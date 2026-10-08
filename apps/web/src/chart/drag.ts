import { round2 } from "@tj/core";

/**
 * A draggable line's id (scalp-R spec §9.3): "stop", or "t1", "t2"… for the targets, in the order the trade
 * reaches them.
 */
export type LineId = string;

/** How near, in pixels, a press must land to grab a line (scalp-review spec §8.3). */
export const GRAB_PX = 6;

/** A missed trade's points (missed-trades spec §6.4): a time and a price each. */
export type PointId = "entry" | "exit";
export const POINT_IDS: readonly string[] = ["entry", "exit"] satisfies PointId[];
export const isPointId = (id: string | null): id is PointId => id != null && POINT_IDS.includes(id);

/** A point on the chart: drawn as a hollow circle at its price, placed and dragged in time and price. */
export interface PointMark {
  id: PointId;
  t: number;
  price: number;
  label: string;
}

/** What the intraday chart reports while the user places or drags the review's lines. */
export interface ChartEditing {
  /** The line or point the next click on the chart places, if any. */
  placing: LineId | PointId | null;
  /** A click placed a line here: save it. */
  onPlace(id: LineId, price: number): void;
  /** A dragged line is here now. Nothing is saved yet. */
  onDrag(id: LineId, price: number): void;
  /** The drag ended here: save it. */
  onDrop(id: LineId, price: number): void;
  /** Esc: stop placing, or a dragged line went back. */
  onCancel(): void;
  /** A click placed a point at this bar's start and a price inside the bar: save it. */
  onPlacePoint?(id: PointId, t: number, price: number): void;
  /** A dragged point ended here: save it. */
  onDropPoint?(id: PointId, t: number, price: number): void;
}

/** How the placing hint names a line: "the stop", or "T2". */
export const lineName = (id: LineId): string =>
  ["stop", "entry", "exit", "target"].includes(id) ? `the ${id}` : id.toUpperCase();

/** The point within reach of (x, y), the closer one when both are. */
export function nearestPoint(
  x: number,
  y: number,
  points: readonly { id: PointId; x: number; y: number }[],
): PointId | null {
  let best: { id: PointId; distance: number } | null = null;
  for (const point of points) {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= GRAB_PX && (!best || distance < best.distance)) best = { id: point.id, distance };
  }
  return best?.id ?? null;
}

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
