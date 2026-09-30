import { render, screen, within } from "@testing-library/react";
import type { GroupStats, MistakeRow } from "@tj/core";
import { describe, expect, it } from "vitest";
import { dumbbellExtent, dumbbellTitle, MistakeCost } from "./MistakeCost.js";

const side = (trades: number, net: number, avgR: number | null, winRate: number): GroupStats => ({
  trades,
  net,
  avgR,
  rCount: avgR == null ? 0 : trades,
  winRate,
  profitFactor: null,
  avgReturn: null,
  returnCount: 0,
});

const CHASED: MistakeRow = {
  tagId: "chased",
  label: "Chased entry",
  withTag: side(7, -310, -0.62, 2 / 7),
  withoutTag: side(31, 1594, 0.52, 19 / 31),
};
const CLEAN: MistakeRow = {
  tagId: null,
  label: "no mistakes",
  withTag: side(21, 1684, 0.71, 14 / 21),
  withoutTag: side(17, -400, -0.28, 7 / 17),
};

describe("MistakeCost", () => {
  it("shows each mistake's scalps against the rest, then no mistakes", () => {
    render(<MistakeCost rows={[CHASED, CLEAN]} />);
    const cells = (label: string) =>
      [...(screen.getByText(label).closest("tr")?.querySelectorAll("td") ?? [])]
        .slice(0, 9)
        .map((cell) => cell.textContent);
    expect(cells("Chased entry")).toEqual([
      "Chased entry",
      "7",
      "−$310",
      "−0.62R",
      "28.6%",
      "31",
      "+$1,594",
      "+0.52R",
      "61.3%",
    ]);
    expect(cells("no mistakes")[0]).toBe("no mistakes");
  });

  it("draws the with dot blue and the without dot gray, joined red when the tag does worse", () => {
    render(<MistakeCost rows={[CHASED, CLEAN]} />);
    const chased = within(screen.getByText("Chased entry").closest("tr") as HTMLElement);
    expect(chased.getByTestId("dot-with").style.left).toBe("calc(34.5% - 5px)");
    expect(chased.getByTestId("dot-without").style.left).toBe("calc(63% - 5px)");
    expect(chased.getByTestId("link").className).toContain("bg-down/60");
    expect(chased.getByTitle("Chased entry: −0.62R with, +0.52R without, 1.14R worse")).toBeTruthy();
    const clean = within(screen.getByText("no mistakes").closest("tr") as HTMLElement);
    expect(clean.getByTestId("link").className).toContain("bg-up/60");
  });

  it("draws no line and one dot when a side has no R, and dashes out an empty side", () => {
    const noR: MistakeRow = { ...CHASED, withTag: side(2, -70, null, 0), withoutTag: null };
    render(<MistakeCost rows={[noR]} />);
    const row = within(screen.getByText("Chased entry").closest("tr") as HTMLElement);
    expect(row.queryByTestId("link")).toBeNull();
    expect(row.queryByTestId("dot-with")).toBeNull();
    expect(row.getAllByText("—")).toHaveLength(5);
    expect(dumbbellTitle(noR)).toBe("Chased entry: no R with, no R without");
  });

  it("widens the axis past ±2R to the next whole R, and labels its ends", () => {
    const wide: MistakeRow = { ...CHASED, withTag: side(3, -300, -2.4, 0) };
    expect(dumbbellExtent([CHASED])).toBe(2);
    expect(dumbbellExtent([wide])).toBe(3);
    render(<MistakeCost rows={[wide]} />);
    for (const tick of ["−3R", "−1.5", "0", "+1.5", "+3R"]) expect(screen.getByText(tick)).toBeTruthy();
  });

  it("says so when no scalp carries a mistake", () => {
    render(<MistakeCost rows={[]} />);
    expect(screen.getByText("No mistakes tagged in this range.")).toBeTruthy();
  });
});
