import { contractsHeld, type LevelBasis, round2, type TargetLevel, trimProblem } from "@tj/core";
import { useMemo, useState } from "react";
import type { TradeView } from "../api.js";
import type { ChartEditing, LineId } from "../chart/drag.js";
import type { PriceLine } from "../chart/IntradayChart.js";
import { COLORS } from "../chart/style.js";
import { type TradePatchBody, useSaveTrade } from "./data.js";
import { useDefaultBasis } from "./prefs.js";

type ScalpPatch = NonNullable<TradePatchBody["scalp"]>;
const NO_TARGETS: TargetLevel[] = [];

/** A typed price, or why it's refused (scalp-review spec §8.4): digits and a decimal point only; above 0 on stock. */
export function parsePrice(text: string, basis: LevelBasis): number | string {
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return "Enter a price like 231.80";
  const price = round2(Number(text));
  if (basis === "stock" && price <= 0) return "A stock price must be above 0";
  return price;
}

/** A typed dollar amount, such as a planned risk (scalp-R spec §9.2): digits and a decimal point; above 0. */
export function parseAmount(text: string): number | string {
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return "Enter an amount like 120";
  const amount = round2(Number(text));
  return amount > 0 ? amount : "A planned risk must be above 0";
}

/** A typed contract count (scalp-R spec §8): a whole number, 1 or more. */
export function parseContracts(text: string): number | string {
  return /^\d+$/.test(text) && Number(text) >= 1 ? Number(text) : "Contracts are a whole number, 1 or more";
}

/** A target's line id: "t1" for the first, in the order the trade reaches them. */
export const targetId = (index: number): LineId => `t${index + 1}`;
/** The target a line id names, or null for the stop. */
export const targetIndex = (id: LineId): number | null =>
  /^t\d+$/.test(id) ? Number(id.slice(1)) - 1 : null;

export interface Levels {
  basis: LevelBasis;
  /** The contracts the scalp holds. */
  size: number;
  /** `shown` follows a line the chart is moving or placing, until its save settles. */
  stop: { saved: number | null; shown: number | null };
  targets: { saved: TargetLevel[]; shown: TargetLevel[] };
  /** The contracts a new target starts with: those no target trims yet, or 1. */
  nextContracts: number;
  /** The contracts of the target being added, while its row is open; null otherwise. */
  draft: number | null;
  /** + Target: opens the new target's row and, on the stock basis, arms the chart. */
  startTarget(): void;
  setDraft(contracts: number): void;
  cancelDraft(): void;
  /** The line the next click on the chart places. */
  placing: LineId | null;
  setPlacing(id: LineId | null): void;
  saveStop(price: number | null): void;
  /** Saves the whole list, which the server puts in order. A list that trims too much is refused here. */
  saveTargets(targets: TargetLevel[]): void;
  saveOverride(field: "stockEntryOverride" | "riskOverride", value: number | null): void;
  switchBasis(next: LevelBasis): void;
  /** Why the page refused to send a save. */
  problem: string | null;
  /** Why the server refused one. */
  error: string | null;
  /** How often the chart has placed or moved each line. A field drops what was typed in it when this changes. */
  chartEdits: Record<LineId, number>;
  /** For the intraday chart: the stock-basis lines, and what placing and dragging them does. */
  chart: { lines: readonly PriceLine[]; editing: ChartEditing };
}

/** A line the chart moved or placed, until its save settles. A new target carries its contracts. */
interface Moved {
  id: LineId;
  price: number;
  contracts?: number;
}

/**
 * A scalp's stop and targets (scalp-review spec §8, scalp-R spec §9.2–9.3), shared by the strip's fields and the
 * intraday chart.
 */
export function useLevels(trade: TradeView): Levels {
  const [defaultBasis] = useDefaultBasis();
  const mutation = useSaveTrade(trade.id);
  const [placing, setPlacing] = useState<LineId | null>(null);
  const [moved, setMoved] = useState<Moved | null>(null);
  // Bumped after a refused save, so the chart redraws its lines where they're saved (scalp-review spec §12).
  const [redraw, setRedraw] = useState(0);
  const [chartEdits, setChartEdits] = useState<Record<LineId, number>>({});
  const [draft, setDraft] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const edited = (id: LineId) => setChartEdits((counts) => ({ ...counts, [id]: (counts[id] ?? 0) + 1 }));
  const basis = trade.scalp?.levelBasis ?? defaultBasis;
  const stop = trade.scalp?.stopPrice ?? null;
  const saved = trade.scalp?.targets ?? NO_TARGETS;
  const size = contractsHeld(trade.legs);
  const nextContracts = Math.max(1, size - saved.reduce((sum, target) => sum + target.contracts, 0));

  const write = (body: ScalpPatch) => {
    setProblem(null);
    mutation.mutate(
      // The basis goes with every write, because the first one creates the row (scalp-review spec §6.2).
      { scalp: { levelBasis: basis, ...body } },
      { onError: () => setRedraw((count) => count + 1), onSettled: () => setMoved(null) },
    );
  };
  const saveTargets = (targets: TargetLevel[]) => {
    const refused = trimProblem(targets, size);
    if (refused) {
      setProblem(refused);
      setMoved(null);
      setRedraw((count) => count + 1);
      return;
    }
    setDraft(null);
    write({ targets });
  };
  /** Saves a line the chart placed or dropped. `contracts` is for a new target. */
  const saveLine = (id: LineId, price: number, contracts: number) => {
    const index = targetIndex(id);
    if (index == null) write({ stopPrice: price });
    else if (index < saved.length) {
      saveTargets(saved.map((target, at) => (at === index ? { ...target, price } : target)));
    } else saveTargets([...saved, { price, contracts }]);
  };

  const movedAt = moved ? targetIndex(moved.id) : null;
  let shownTargets = saved;
  if (moved && movedAt != null) {
    shownTargets =
      movedAt < saved.length
        ? saved.map((target, at) => (at === movedAt ? { ...target, price: moved.price } : target))
        : [...saved, { price: moved.price, contracts: moved.contracts ?? nextContracts }];
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw asks for a fresh array after a refused save
  const lines = useMemo<PriceLine[]>(() => {
    if (basis !== "stock") return [];
    const stopLine: PriceLine[] =
      stop == null ? [] : [{ id: "stop", price: stop, dashed: true, color: COLORS.down, label: "STOP" }];
    return [
      ...stopLine,
      ...saved.map((target, index) => ({
        id: targetId(index),
        price: target.price,
        dashed: true,
        color: COLORS.up,
        label: `T${index + 1} ×${target.contracts}`,
      })),
    ];
  }, [basis, stop, saved, redraw]);

  return {
    basis,
    size,
    stop: { saved: stop, shown: moved?.id === "stop" ? moved.price : stop },
    targets: { saved, shown: shownTargets },
    nextContracts,
    draft,
    startTarget: () => {
      setProblem(null);
      setDraft(nextContracts);
      if (basis === "stock") setPlacing(targetId(saved.length));
    },
    setDraft,
    cancelDraft: () => setDraft(null),
    placing,
    setPlacing,
    saveStop: (price) => write({ stopPrice: price }),
    saveTargets,
    saveOverride: (field, value) =>
      write(field === "stockEntryOverride" ? { stockEntryOverride: value } : { riskOverride: value }),
    switchBasis: (next) => {
      setPlacing(null);
      setDraft(null);
      write({ levelBasis: next });
    },
    problem,
    error: mutation.error?.message ?? null,
    chartEdits,
    chart: {
      lines,
      editing: {
        // Premium levels are typed: there's no option chart to place them on.
        placing: basis === "stock" ? placing : null,
        onPlace: (id, price) => {
          const contracts = draft ?? nextContracts;
          setPlacing(null);
          edited(id);
          setMoved({ id, price, contracts });
          saveLine(id, price, contracts);
        },
        onDrag: (id, price) => {
          edited(id);
          setMoved({ id, price });
        },
        onDrop: (id, price) => {
          edited(id);
          setMoved({ id, price });
          saveLine(id, price, nextContracts);
        },
        onCancel: () => {
          setPlacing(null);
          setMoved(null);
        },
      },
    },
  };
}
