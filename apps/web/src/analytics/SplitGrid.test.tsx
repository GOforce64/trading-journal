import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitGrid } from "./SplitGrid.js";

const rows = [
  { label: "Wed", trades: 3, winRate: 1, net: 550, profitFactor: Number.POSITIVE_INFINITY },
  { label: "Thu", trades: 2, winRate: 0, net: -400, profitFactor: 0 },
];

describe("SplitGrid", () => {
  it("shows each row's trades and net, with win rate and profit factor on hover", () => {
    render(<SplitGrid panels={[{ title: "Weekday opened", rows }]} />);
    const panel = within(screen.getByRole("region", { name: "Weekday opened" }));
    expect(panel.getByText("+$550")).toBeTruthy();
    expect(panel.getByTitle("Win rate 100.0% · PF ∞")).toBeTruthy();
    expect(panel.getByTitle("Win rate 0.0% · PF 0.00")).toBeTruthy();
  });

  it("says so when a split has no trades", () => {
    render(<SplitGrid panels={[{ title: "Hold time", rows: [] }]} />);
    expect(screen.getByText("No closed trades in this range.")).toBeTruthy();
  });

  it("saves edited edges, refuses bad ones with the rule, and resets", () => {
    const onChange = vi.fn();
    render(
      <SplitGrid
        panels={[{ title: "Credit", rows, edges: { kind: "usd", edges: [250, 500, 1000], onChange } }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    const input = screen.getByLabelText("Credit edges") as HTMLInputElement;
    expect(input.value).toBe("250, 500, 1000");

    fireEvent.change(input, { target: { value: "1,000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Use increasing amounts above 0, like 250, 500, 1000.",
    );
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "300, 600" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenLastCalledWith([300, 600]);

    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("previews the buckets as edges are typed, so 2,500 shows itself as two edges", () => {
    render(
      <SplitGrid
        panels={[
          { title: "Credit", rows, edges: { kind: "usd", edges: [250, 500, 1000], onChange: vi.fn() } },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByTestId("edge-preview").textContent).toBe("< $250 · $250–500 · $500–1,000 · $1,000+");
    fireEvent.change(screen.getByLabelText("Credit edges"), { target: { value: "2,500" } });
    expect(screen.getByTestId("edge-preview").textContent).toBe("< $2 · $2–500 · $500+");
  });
});
