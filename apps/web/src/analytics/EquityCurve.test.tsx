import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EquityCurve } from "./EquityCurve.js";

// The canvas can't draw in jsdom. This stand-in for createChart records what the component asks of the library.
const library = vi.hoisted(() => ({ charts: 0, setData: 0 }));
vi.mock("lightweight-charts", async (importOriginal) => {
  const real = await importOriginal<typeof import("lightweight-charts")>();
  return {
    ...real,
    createChart: () => {
      library.charts++;
      return {
        addSeries: () => ({ setData: () => library.setData++ }),
        panes: () => [],
        timeScale: () => ({ fitContent: () => {} }),
        remove: () => {},
      };
    },
  };
});

beforeEach(() => {
  library.charts = 0;
  library.setData = 0;
});

const A = { id: "a", closedAt: 1_000_000, equity: 100, drawdown: 0 };
const B = { id: "b", closedAt: 2_000_000, equity: 50, drawdown: -50 };

describe("EquityCurve", () => {
  it("says there is nothing to draw without closed trades", () => {
    render(<EquityCurve points={[]} />);
    expect(screen.getByText("No closed trades in this range.")).toBeTruthy();
  });

  it("builds the chart once, so a re-render with the same points keeps the user's zoom", () => {
    const { rerender } = render(<EquityCurve points={[A]} />);
    rerender(<EquityCurve points={[A]} />);
    expect(library.charts).toBe(1);
    expect(library.setData).toBe(2); // equity and drawdown, once each
    rerender(<EquityCurve points={[A, B]} />);
    expect(library.charts).toBe(1);
    expect(library.setData).toBe(4);
  });
});
