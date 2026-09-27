import { describe, expect, it } from "vitest";
import { dollars, profitFactorText, shareText, winRateText } from "./format.js";

describe("formatters", () => {
  it("write rates, factors, shares and dollars", () => {
    expect(winRateText(2 / 3)).toBe("66.7%");
    expect(winRateText(null)).toBe("—");
    expect(profitFactorText(750 / 550)).toBe("1.36");
    expect(profitFactorText(Number.POSITIVE_INFINITY)).toBe("∞");
    expect(profitFactorText(null)).toBe("—");
    expect(shareText(0.3875)).toBe("39%");
    expect(shareText(-0.1)).toBe("−10%");
    expect(shareText(null)).toBe("—");
    expect(dollars(410.1)).toBe("+$410");
    expect(dollars(-2324)).toBe("−$2,324");
    expect(dollars(0)).toBe("$0");
  });
});
