import { DEFAULT_EDGES, type EdgeKind, parseEdges } from "@tj/core";

/** The splits whose edges can be edited: the flies' credit, contracts, and the scalps' option cost. */
export type EdgeSplit = "credit" | "contracts" | "cost";

/** Each split's rules for parsing, and where this browser remembers its edges. */
export const EDGE_SPLITS: Record<EdgeSplit, { kind: EdgeKind; key: string }> = {
  credit: { kind: "usd", key: "tj.edges.credit" },
  contracts: { kind: "contracts", key: "tj.edges.contracts" },
  cost: { kind: "usd", key: "tj.edges.cost" },
};

function remembered(split: EdgeSplit): number[] | null {
  const { kind, key } = EDGE_SPLITS[split];
  try {
    const saved = localStorage.getItem(key);
    return saved ? parseEdges(saved, kind) : null;
  } catch {
    return null;
  }
}

/** The edges a split uses: the URL's, else the ones remembered in this browser, else the defaults. */
export function resolveEdges(split: EdgeSplit, fromUrl?: string): number[] {
  const { kind } = EDGE_SPLITS[split];
  return (fromUrl ? parseEdges(fromUrl, kind) : null) ?? remembered(split) ?? [...DEFAULT_EDGES[kind]];
}

/** Remembers edges for this browser, or forgets them with null. False when storage is blocked; the URL still carries them. */
export function rememberEdges(split: EdgeSplit, edges: readonly number[] | null): boolean {
  const { key } = EDGE_SPLITS[split];
  try {
    if (edges) localStorage.setItem(key, edges.join(","));
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
