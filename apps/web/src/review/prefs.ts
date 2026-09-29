import { LEVEL_BASES, type LevelBasis } from "@tj/core";
import { useState } from "react";

const KEY = "tj.review";

/** The basis a scalp's review starts on (scalp-review spec §11). Storage can be missing or refuse: stock, then. */
export function loadLevelBasis(): LevelBasis {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const basis =
      typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>).levelBasis : null;
    return LEVEL_BASES.find((each) => each === basis) ?? "stock";
  } catch {
    return "stock";
  }
}

export function saveLevelBasis(basis: LevelBasis): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ levelBasis: basis }));
  } catch {
    // A private window: the choice lasts until the page closes.
  }
}

/** The default basis, and a setter that remembers it. */
export function useDefaultBasis(): [LevelBasis, (next: LevelBasis) => void] {
  const [basis, setBasis] = useState(loadLevelBasis);
  return [
    basis,
    (next) => {
      saveLevelBasis(next);
      setBasis(next);
    },
  ];
}
