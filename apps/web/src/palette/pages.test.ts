import { describe, expect, it } from "vitest";
import { matchPages, PAGES } from "./pages.js";

const labels = (text: string) => matchPages(text).map((page) => page.label);

describe("matchPages", () => {
  it("lists every page with nothing typed", () => {
    expect(matchPages("")).toEqual(PAGES);
    expect(PAGES).toHaveLength(15);
  });

  it("matches the start of each word, in order", () => {
    expect(labels("an sc")).toEqual(["Analytics › Scalps"]);
    expect(labels("to rev")).toEqual(["Scalps › To review"]);
    expect(labels("missed")).toEqual(["Missed", "Analytics › Missed"]);
    expect(labels("sc an")).toEqual([]);
    expect(labels("nvda")).toEqual([]);
    expect(labels("sw")).toEqual(["Swings", "Analytics › Swings"]);
    expect(labels("an sw")).toEqual(["Analytics › Swings"]);
  });
});
