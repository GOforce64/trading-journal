import { afterEach, describe, expect, it } from "vitest";
import { loadLevelBasis, saveLevelBasis } from "./prefs.js";

afterEach(() => localStorage.clear());

describe("the default basis", () => {
  it("is stock until changed, and remembers a change", () => {
    expect(loadLevelBasis()).toBe("stock");
    saveLevelBasis("premium");
    expect(loadLevelBasis()).toBe("premium");
    expect(JSON.parse(localStorage.getItem("tj.review") ?? "{}")).toEqual({ levelBasis: "premium" });
  });

  it("falls back to stock for anything unreadable", () => {
    localStorage.setItem("tj.review", "{not json");
    expect(loadLevelBasis()).toBe("stock");
    localStorage.setItem("tj.review", JSON.stringify({ levelBasis: "delta" }));
    expect(loadLevelBasis()).toBe("stock");
  });
});
