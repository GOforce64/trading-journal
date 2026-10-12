import { useSyncExternalStore } from "react";

/** Whether Stop the journal has stopped the server (launcher spec §3.4): the app then shows only that. */
let stopped = false;
const listeners = new Set<() => void>();

export function markStopped(): void {
  stopped = true;
  for (const listener of listeners) listener();
}

export function useStopped(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => stopped,
  );
}

/** Tests only. */
export function resetStopped(): void {
  stopped = false;
}
