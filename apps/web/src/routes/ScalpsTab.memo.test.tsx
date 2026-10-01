import { screen, waitFor } from "@testing-library/react";
import * as core from "@tj/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCALP_ROWS, SCALP_SETUPS, SCALP_TAGS } from "../analytics/scalps.fixture.js";
import { renderWithClient, stubTrades } from "../analytics/testing.js";
import { Analytics } from "./Analytics.js";

vi.mock("../analytics/ScalpCharts.js", () => ({ MetricBars: () => null }));
vi.mock("@tj/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@tj/core")>();
  return { ...real, scalpBreakdown: vi.fn(real.scalpBreakdown), mistakeCost: vi.fn(real.mistakeCost) };
});

afterEach(() => vi.unstubAllGlobals());

describe("Analytics Scalps tab", () => {
  it("works its numbers out once for the same scalps, not on every render", async () => {
    stubTrades(SCALP_ROWS, [], { setups: SCALP_SETUPS, tags: SCALP_TAGS });
    // The router hands back the same search object while the URL is unchanged.
    const search = { tab: "scalps" } as const;
    const { rerender } = renderWithClient(<Analytics search={search} onSearch={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Mistake cost" }).textContent).toContain("Moved stop"),
    );
    const breakdowns = vi.mocked(core.scalpBreakdown).mock.calls.length;
    const mistakes = vi.mocked(core.mistakeCost).mock.calls.length;
    // A new callback is a new render, with nothing new to count.
    rerender(<Analytics search={search} onSearch={() => {}} />);
    rerender(<Analytics search={search} onSearch={() => {}} />);
    expect(vi.mocked(core.scalpBreakdown).mock.calls.length).toBe(breakdowns);
    expect(vi.mocked(core.mistakeCost).mock.calls.length).toBe(mistakes);
  });
});
