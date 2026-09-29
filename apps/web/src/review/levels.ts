import { type LevelBasis, round2 } from "@tj/core";
import { useMemo, useState } from "react";
import type { TradeView } from "../api.js";
import type { ChartEditing, LevelKind } from "../chart/drag.js";
import type { PriceLine } from "../chart/IntradayChart.js";
import { COLORS } from "../chart/style.js";
import { useSaveTrade } from "./data.js";
import { useDefaultBasis } from "./prefs.js";

const KINDS: readonly LevelKind[] = ["stop", "target"];
const LOOK = {
  stop: { color: COLORS.down, label: "STOP" },
  target: { color: COLORS.up, label: "TARGET" },
} as const;

/** A typed price, or why it's refused (scalp-review spec §8.4): digits and a decimal point only; above 0 on stock. */
export function parsePrice(text: string, basis: LevelBasis): number | string {
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return "Enter a price like 231.80";
  const price = round2(Number(text));
  if (basis === "stock" && price <= 0) return "A stock price must be above 0";
  return price;
}

export interface Levels {
  basis: LevelBasis;
  /** What each field shows: the saved price, or where a line on the chart is before it's saved. */
  shown: Record<LevelKind, number | null>;
  saved: Record<LevelKind, number | null>;
  /** The line the next click on the chart places. */
  placing: LevelKind | null;
  setPlacing(kind: LevelKind | null): void;
  save(kind: LevelKind, price: number | null): void;
  switchBasis(next: LevelBasis): void;
  error: string | null;
  /** For the intraday chart: the stock-basis lines, and what placing and dragging them does. */
  chart: { lines: readonly PriceLine[]; editing: ChartEditing };
}

/** A scalp's stop and target (scalp-review spec §8), shared by its fields and the intraday chart. */
export function useLevels(trade: TradeView): Levels {
  const [defaultBasis] = useDefaultBasis();
  const mutation = useSaveTrade(trade.id);
  const [placing, setPlacing] = useState<LevelKind | null>(null);
  // A line the chart moved or placed, until its save is settled.
  const [moved, setMoved] = useState<{ kind: LevelKind; price: number } | null>(null);
  // Bumped after a refused save, so the chart redraws its lines where they're saved (spec §12).
  const [redraw, setRedraw] = useState(0);
  const basis = trade.scalp?.levelBasis ?? defaultBasis;
  const stop = trade.scalp?.stopPrice ?? null;
  const target = trade.scalp?.targetPrice ?? null;

  const write = (body: { levelBasis?: LevelBasis; stopPrice?: number | null; targetPrice?: number | null }) =>
    mutation.mutate(
      // The basis goes with every write, because the first one creates the row (spec §6.2).
      { scalp: { levelBasis: basis, ...body } },
      { onError: () => setRedraw((count) => count + 1), onSettled: () => setMoved(null) },
    );
  const save = (kind: LevelKind, price: number | null) =>
    write(kind === "stop" ? { stopPrice: price } : { targetPrice: price });

  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw asks for a fresh array after a refused save
  const lines = useMemo<PriceLine[]>(
    () =>
      basis !== "stock"
        ? []
        : KINDS.flatMap((kind) => {
            const price = kind === "stop" ? stop : target;
            return price == null ? [] : [{ id: kind, price, dashed: true, ...LOOK[kind] }];
          }),
    [basis, stop, target, redraw],
  );

  return {
    basis,
    saved: { stop, target },
    shown: {
      stop: moved?.kind === "stop" ? moved.price : stop,
      target: moved?.kind === "target" ? moved.price : target,
    },
    placing,
    setPlacing,
    save,
    switchBasis: (next) => {
      setPlacing(null);
      write({ levelBasis: next });
    },
    error: mutation.error?.message ?? null,
    chart: {
      lines,
      editing: {
        // Premium levels are typed: there's no option chart to place them on.
        placing: basis === "stock" ? placing : null,
        onPlace: (kind, price) => {
          setPlacing(null);
          setMoved({ kind, price });
          save(kind, price);
        },
        onDrag: (kind, price) => setMoved({ kind, price }),
        onDrop: (kind, price) => {
          setMoved({ kind, price });
          save(kind, price);
        },
        onCancel: () => {
          setPlacing(null);
          setMoved(null);
        },
      },
    },
  };
}
