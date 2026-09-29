/** A trade's place in the To review queue (scalp-review spec §7.2). */
export interface QueueItem {
  id: string;
  openedAt: number;
}

export interface QueueNav {
  /** This trade's place in the queue, from 1, while it's pending; null otherwise. */
  position: number | null;
  /** How many wait, this trade included when it's pending. */
  total: number;
  /** How many other trades wait. */
  left: number;
  /** The next pending trade opened after this one, wrapping to the oldest; null when no other waits. */
  next: string | null;
  /** The last pending trade opened before this one, wrapping to the newest. */
  prev: string | null;
}

const order = (a: QueueItem, b: QueueItem) =>
  a.openedAt - b.openedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Where `current` sits among the `pending` trades. The trade's own status decides whether it counts, so a list
 * fetched before its last save can't put a reviewed trade back in the queue, or leave a pending one out.
 */
export function queueNav(
  pending: readonly QueueItem[],
  current: QueueItem,
  currentPending: boolean,
): QueueNav {
  const others = pending.filter((each) => each.id !== current.id).sort(order);
  const after = others.filter((each) => order(each, current) > 0);
  const before = others.filter((each) => order(each, current) < 0);
  return {
    position: currentPending ? before.length + 1 : null,
    total: others.length + (currentPending ? 1 : 0),
    left: others.length,
    next: (after[0] ?? others[0])?.id ?? null,
    prev: (before.at(-1) ?? others.at(-1))?.id ?? null,
  };
}
