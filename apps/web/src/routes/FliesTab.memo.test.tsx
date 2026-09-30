import { screen } from "@testing-library/react";
import * as core from "@tj/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithClient, stubTrades, tradeRow } from "../analytics/testing.js";
import { Analytics } from "./Analytics.js";

vi.mock("../analytics/Charts.js", () => ({
  KeptHistogram: () => null,
  MonthBars: () => null,
  RollingLine: () => null,
}));
vi.mock("../analytics/MoveCharts.js", () => ({ MoveScatter: () => null, CrushHistogram: () => null }));
vi.mock("@tj/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@tj/core")>();
  return { ...real, movePoints: vi.fn(real.movePoints) };
});

afterEach(() => vi.unstubAllGlobals());

describe("Analytics Iron flies tab", () => {
  it("works the move data out once for the same flies, not on every render", async () => {
    stubTrades([
      tradeRow({
        id: "a",
        underlying: "AA",
        opened: "2026-09-02 15:45",
        closed: "2026-09-03 09:50",
        netPnl: 100,
      }),
    ]);
    // The router hands back the same search object while the URL is unchanged.
    const search = { tab: "flies" } as const;
    const { rerender } = renderWithClient(<Analytics search={search} onSearch={() => {}} />);
    expect(await screen.findByTestId("move-coverage")).toBeTruthy();
    const calls = vi.mocked(core.movePoints).mock.calls.length;
    rerender(<Analytics search={search} onSearch={() => {}} />);
    rerender(<Analytics search={search} onSearch={() => {}} />);
    expect(vi.mocked(core.movePoints).mock.calls.length).toBe(calls);
  });
});
