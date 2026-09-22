import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IronFlyForm, type IronFlyFormValues } from "./IronFlyForm.js";

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** The sample fly, priced leg by leg: short 50 straddle, wings 45 / 58, 4 lots. */
function priceTheSampleFly() {
  fill("Underlying", "XYZ");
  fill("Expiry", "2026-10-16");
  fill("Short call strike", "50");
  fill("Short call size", "4");
  fill("Short call entry", "2.10");
  fill("Short call exit", "1.00");
  fill("Short put strike", "50");
  fill("Short put size", "4");
  fill("Short put entry", "1.60");
  fill("Short put exit", "0.80");
  fill("Long call strike", "58");
  fill("Long call size", "4");
  fill("Long call entry", "0.35");
  fill("Long call exit", "0.05");
  fill("Long put strike", "45");
  fill("Long put size", "4");
  fill("Long put entry", "0.35");
  fill("Long put exit", "0.05");
  fill("Entry fees", "5");
  fill("Exit fees", "3");
}

function setup(initial?: Partial<IronFlyFormValues>) {
  const onSubmit = vi.fn();
  render(<IronFlyForm initial={initial} submitLabel="Save trade" onSubmit={onSubmit} />);
  return { onSubmit };
}

describe("IronFlyForm", () => {
  it("derives the cash from the leg prices instead of asking for it", () => {
    setup();
    priceTheSampleFly();
    const summary = screen.getByTestId("derived");
    expect(summary.textContent).toContain("1,192.00"); // net cost: credit less fees
    expect(summary.textContent).toContain("520.00"); // P&L before fees
    expect(summary.textContent).toContain("512.00"); // net P&L
    expect(summary.textContent).toContain("2,008.00"); // max loss, call side
    expect(summary.textContent).toContain("47.02"); // breakevens
  });

  it("leaves P&L open while an exit price is missing", () => {
    setup();
    priceTheSampleFly();
    fill("Short put exit", "");
    expect(screen.getByTestId("derived-net-pnl").textContent).toContain("—");
  });

  it("submits legs, structure and derived cash", () => {
    const { onSubmit } = setup();
    priceTheSampleFly();
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload.underlying).toBe("XYZ");
    expect(payload.legs).toHaveLength(4);
    expect(payload.legs.filter((leg: { quantity: number }) => leg.quantity === -4)).toHaveLength(2);
    expect(payload.legs.filter((leg: { quantity: number }) => leg.quantity === 4)).toHaveLength(2);
    expect(payload.netPnl).toBe(512);
    expect(payload.fees).toBe(8);
    expect(payload.feesOpen).toBe(5);
    expect(payload.feesClose).toBe(3);
    expect(payload.ironFly.bodyCallStrike).toBe(50);
    expect(payload.ironFly.callWingStrike).toBe(58);
    expect(payload.ironFly.putWingStrike).toBe(45);
    expect(payload.ironFly.contracts).toBe(4);
    expect(payload.ironFly.netCost).toBe(-1192);
  });

  it("refuses to submit an incomplete structure", () => {
    const { onSubmit } = setup();
    fill("Underlying", "XYZ");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/every leg needs a strike, a size and an entry price/i)).toBeTruthy();
  });

  it("starts from an existing trade when editing", () => {
    setup({
      underlying: "ACME",
      expiry: "2026-09-18",
      legs: {
        shortCall: { strike: "30", size: "3", entry: "1.40", exit: "2.60" },
        shortPut: { strike: "30", size: "3", entry: "1.10", exit: "0.20" },
        longCall: { strike: "35", size: "3", entry: "0.20", exit: "0.50" },
        longPut: { strike: "25", size: "3", entry: "0.20", exit: "0.02" },
      },
    });
    expect((screen.getByLabelText("Underlying") as HTMLInputElement).value).toBe("ACME");
    expect((screen.getByLabelText("Short call strike") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("Long put exit") as HTMLInputElement).value).toBe("0.02");
  });
});
