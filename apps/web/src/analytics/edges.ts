import { DEFAULT_EDGES, type EdgeKind, parseEdges } from "@tj/core";

const KEYS: Record<EdgeKind, string> = { usd: "tj.edges.credit", contracts: "tj.edges.contracts" };

function remembered(kind: EdgeKind): number[] | null {
  try {
    const saved = localStorage.getItem(KEYS[kind]);
    return saved ? parseEdges(saved, kind) : null;
  } catch {
    return null;
  }
}

/** The edges a split uses: the URL's, else the ones remembered in this browser, else the defaults. */
export function resolveEdges(kind: EdgeKind, fromUrl?: string): number[] {
  return (fromUrl ? parseEdges(fromUrl, kind) : null) ?? remembered(kind) ?? [...DEFAULT_EDGES[kind]];
}

/** Remembers edges for this browser, or forgets them with null. False when storage is blocked; the URL still carries them. */
export function rememberEdges(kind: EdgeKind, edges: readonly number[] | null): boolean {
  try {
    if (edges) localStorage.setItem(KEYS[kind], edges.join(","));
    else localStorage.removeItem(KEYS[kind]);
    return true;
  } catch {
    return false;
  }
}
