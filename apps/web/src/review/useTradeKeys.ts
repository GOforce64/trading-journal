import type { Grade } from "@tj/core";
import { useState } from "react";
import type { TradeView } from "../api.js";
import { useShortcut } from "../keys/Shortcuts.js";
import type { OpenTrade } from "../nav/tradeList.js";
import type { TradeNav } from "../nav/useTradeNav.js";
import { type TradePatchBody, useSaveTrade } from "./data.js";

const field = (name: string) => document.querySelector<HTMLElement>(`[data-key-target="${name}"]`);

/** S, M, E, N (spec §6.2–6.3): the setup's list opens; a chip group's first chip, or the notes, takes focus. */
function focusField(name: string): void {
  const target = field(name);
  if (!target) return;
  if (target instanceof HTMLSelectElement) {
    target.focus();
    try {
      // Its list, where arrows only move the highlight: a focused select would save on every arrow.
      target.showPicker();
    } catch {
      // Not supported, or refused: the focus stays.
    }
    return;
  }
  if (target instanceof HTMLTextAreaElement) {
    target.focus();
    // After what's there, to add to it: a focused textarea's cursor would otherwise start at its beginning.
    target.setSelectionRange(target.value.length, target.value.length);
    return;
  }
  target.querySelector<HTMLElement>("button")?.focus();
}

/**
 * The keys on a trade's page (launcher-keys-palette spec §6.1): J/K, 1–5, Enter, S/M/E/N, P/T, X. Only those that
 * apply are registered, so the ? help shows only those. A failed save leaves `error` for the page to show.
 */
export function useTradeKeys({
  trade,
  nav,
  onOpenTrade,
  chart,
}: {
  trade: TradeView | undefined;
  nav: TradeNav;
  onOpenTrade?: OpenTrade;
  /** Whether the page has a chart to place levels on: scalps and missed trades. */
  chart: boolean;
}): { error: string | null } {
  const save = useSaveTrade(trade?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const ready = trade != null;
  const patch = (body: TradePatchBody) => {
    setError(null);
    return save.mutateAsync(body).then(
      () => true,
      (problem: unknown) => {
        setError(problem instanceof Error ? problem.message : String(problem));
        return false;
      },
    );
  };
  const go = (id: string | null) => {
    if (id) onOpenTrade?.(id, nav.list ?? undefined);
  };
  const grade = (each: Grade) => () => {
    if (trade) void patch({ grade: trade.grade === each ? null : each });
  };
  // J and K also work on a trade that's gone, so a list goes on past it (spec §9).
  const moves = nav.list != null;
  const unfinished =
    trade?.review?.status === "pending" && trade.review.missing.length > 0 && trade.reviewedAt == null;
  const missed = trade?.book === "missed";

  useShortcut(moves ? "j" : null, "Next trade", "Review", () => go(nav.next));
  useShortcut(moves ? "k" : null, "Previous trade", "Review", () => go(nav.prev));
  useShortcut(ready ? "1" : null, "Grade A", "Review", grade("A"));
  useShortcut(ready ? "2" : null, "Grade B", "Review", grade("B"));
  useShortcut(ready ? "3" : null, "Grade C", "Review", grade("C"));
  useShortcut(ready ? "4" : null, "Grade D", "Review", grade("D"));
  useShortcut(ready ? "5" : null, "Grade F", "Review", grade("F"));
  useShortcut(
    moves || (ready && unfinished) ? "Enter" : null,
    unfinished ? "Done, then next" : "Next trade",
    "Review",
    () => {
      if (!unfinished) return go(nav.next);
      void patch({ reviewed: true }).then((saved) => {
        if (saved) go(nav.next);
      });
    },
  );
  useShortcut(ready ? "s" : null, "Setup", "Review", () => focusField("setup"));
  useShortcut(ready ? "m" : null, missed ? "Skip reasons" : "Mistakes", "Review", () =>
    focusField(missed ? "skip" : "mistake"),
  );
  useShortcut(ready ? "e" : null, "Emotion", "Review", () => focusField("emotion"));
  useShortcut(ready ? "n" : null, "Notes", "Review", () => focusField("notes"));
  useShortcut(ready && chart ? "p" : null, "Place the stop", "Chart", () => field("place-stop")?.click());
  useShortcut(ready && chart ? "t" : null, "Place a target", "Chart", () => field("place-target")?.click());
  useShortcut(ready ? "x" : null, "Exclude from stats", "Review", () => {
    if (trade) void patch({ excluded: !trade.excluded });
  });
  return { error };
}
