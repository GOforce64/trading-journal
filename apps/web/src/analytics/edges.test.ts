import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberEdges, resolveEdges } from "./edges.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("resolveEdges", () => {
  it("prefers the URL, then what was remembered, then the defaults", () => {
    expect(resolveEdges("usd")).toEqual([250, 500, 1000]);
    rememberEdges("usd", [300, 600]);
    expect(resolveEdges("usd")).toEqual([300, 600]);
    expect(resolveEdges("usd", "400,800")).toEqual([400, 800]);
    expect(resolveEdges("usd", "abc")).toEqual([300, 600]);
  });

  it("keeps credit and contract edges apart", () => {
    rememberEdges("contracts", [3, 6]);
    expect(localStorage.getItem("tj.edges.contracts")).toBe("3,6");
    expect(resolveEdges("usd")).toEqual([250, 500, 1000]);
  });

  it("forgets on reset", () => {
    rememberEdges("usd", [300]);
    rememberEdges("usd", null);
    expect(resolveEdges("usd")).toEqual([250, 500, 1000]);
  });

  it("falls back to the defaults when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(resolveEdges("usd")).toEqual([250, 500, 1000]);
    expect(rememberEdges("usd", [300])).toBe(false);
  });
});
