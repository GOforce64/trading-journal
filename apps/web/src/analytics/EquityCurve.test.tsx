import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EquityCurve } from "./EquityCurve.js";

describe("EquityCurve", () => {
  it("says there is nothing to draw without closed trades", () => {
    render(<EquityCurve points={[]} />);
    expect(screen.getByText("No closed trades in this range.")).toBeTruthy();
  });
});
