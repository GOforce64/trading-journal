import { describe, expect, it } from "vitest";
import { inPane, nearestLine, priceAt } from "./drag.js";

// 240 at the top of a 400 px pane, 220 at the bottom: 0.05 a pixel.
const toY = (price: number) => ((240 - price) / 20) * 400;
const toPrice = (y: number) => 240 - (y / 400) * 20;
// The stop sits at y 164, the target at y 158.
const LINES = [
  { id: "stop" as const, price: 231.8 },
  { id: "target" as const, price: 232.1 },
];

describe("nearestLine", () => {
  it("grabs a line within 6 px, and the closer one when both are", () => {
    expect(nearestLine(LINES, 169, toY)).toBe("stop");
    expect(nearestLine(LINES, 161.5, toY)).toBe("stop");
    expect(nearestLine(LINES, 160, toY)).toBe("target");
  });

  it("grabs nothing further away, nothing off the scale, and nothing without lines", () => {
    expect(nearestLine(LINES, 171, toY)).toBeNull();
    expect(nearestLine(LINES, 164, () => null)).toBeNull();
    expect(nearestLine([], 164, toY)).toBeNull();
  });
});

describe("priceAt", () => {
  it("reads the price at a height, to the cent", () => {
    expect(priceAt(164, toPrice)).toBe(231.8);
    expect(priceAt(164.8, toPrice)).toBe(231.76);
    expect(priceAt(180, toPrice)).toBe(231);
  });

  it("reads nothing off the scale, or at or below zero", () => {
    expect(priceAt(10, () => null)).toBeNull();
    expect(priceAt(10, () => 0)).toBeNull();
    expect(priceAt(10, () => -2)).toBeNull();
  });
});

describe("inPane", () => {
  it("is the plot, not the axes", () => {
    const pane = { width: 800, height: 400 };
    expect(inPane(10, 10, pane)).toBe(true);
    expect(inPane(800, 10, pane)).toBe(false);
    expect(inPane(10, 400, pane)).toBe(false);
    expect(inPane(-1, 10, pane)).toBe(false);
  });
});
