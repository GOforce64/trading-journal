import { render } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { MonthBars } from "./Charts.js";

// jsdom has no layout, so the responsive wrapper would measure 0 × 0; a fixed size lets Recharts draw for real.
vi.mock("recharts", async (importOriginal) => {
  const real = await importOriginal<typeof import("recharts")>();
  return {
    ...real,
    ResponsiveContainer: ({
      children,
      height,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
      height: number;
    }) => cloneElement(children, { width: 400, height }),
  };
});

const bars = (container: HTMLElement) => container.querySelectorAll(".recharts-bar-rectangle path").length;

describe("MonthBars", () => {
  it("draws every month from zero in a losing year, the smallest loss included", () => {
    const { container } = render(
      <MonthBars
        months={[
          { month: "2026-07", net: -700, trades: 5 },
          { month: "2026-08", net: -820, trades: 6 },
          { month: "2026-09", net: -760, trades: 4 },
        ]}
      />,
    );
    expect(bars(container)).toBe(3);
    expect(container.querySelector(".recharts-reference-line")).not.toBeNull();
  });

  it("draws every month from zero in a winning year too", () => {
    const { container } = render(
      <MonthBars
        months={[
          { month: "2026-07", net: 700, trades: 5 },
          { month: "2026-08", net: 820, trades: 6 },
          { month: "2026-09", net: 760, trades: 4 },
        ]}
      />,
    );
    expect(bars(container)).toBe(3);
  });
});
