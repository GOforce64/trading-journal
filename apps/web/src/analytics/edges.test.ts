import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberEdges, resolveEdges } from "./edges.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("resolveEdges", () => {
  it("prefers the URL, then what was remembered, then the defaults", () => {
    expect(resolveEdges("credit")).toEqual([250, 500, 1000]);
    rememberEdges("credit", [300, 600]);
    expect(resolveEdges("credit")).toEqual([300, 600]);
    expect(resolveEdges("credit", "400,800")).toEqual([400, 800]);
    expect(resolveEdges("credit", "abc")).toEqual([300, 600]);
  });

  it("keeps credit, contract and option-cost edges apart", () => {
    rememberEdges("contracts", [3, 6]);
    expect(localStorage.getItem("tj.edges.contracts")).toBe("3,6");
    expect(resolveEdges("credit")).toEqual([250, 500, 1000]);
    rememberEdges("cost", [100, 200]);
    expect(localStorage.getItem("tj.edges.cost")).toBe("100,200");
    expect(resolveEdges("cost")).toEqual([100, 200]);
    expect(resolveEdges("credit")).toEqual([250, 500, 1000]);
  });

  it("forgets on reset", () => {
    rememberEdges("credit", [300]);
    rememberEdges("credit", null);
    expect(resolveEdges("credit")).toEqual([250, 500, 1000]);
  });

  it("falls back to the defaults when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(resolveEdges("credit")).toEqual([250, 500, 1000]);
    expect(rememberEdges("credit", [300])).toBe(false);
  });
});
