import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChartSettings } from "./ChartSettings.js";

afterEach(() => localStorage.clear());

describe("ChartSettings", () => {
  it("edits the four EMA lengths, kept in this browser", () => {
    render(<ChartSettings />);
    expect((screen.getByLabelText("EMA 4") as HTMLInputElement).value).toBe("167");
    fireEvent.change(screen.getByLabelText("EMA 4"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    expect(JSON.parse(localStorage.getItem("tj.chart") ?? "{}").emaLengths).toEqual([8, 20, 50, 200]);
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("refuses a length that isn't a whole number from 1 to 500", () => {
    render(<ChartSettings />);
    fireEvent.change(screen.getByLabelText("EMA 1"), { target: { value: "0" } });
    expect((screen.getByRole("button", { name: "Save chart" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("EMA 1"), { target: { value: "9x" } });
    expect((screen.getByRole("button", { name: "Save chart" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the default basis for stops and targets in this browser, stock to start", () => {
    render(<ChartSettings />);
    expect(screen.getByRole("button", { name: "Stock" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Premium" }));
    expect(screen.getByRole("button", { name: "Premium" }).getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(localStorage.getItem("tj.review") ?? "{}")).toEqual({ levelBasis: "premium" });
  });
});
