import { describe, expect, it } from "vitest";
import { chance, int, mulberry32, normal, pick, stream, uniform, weighted } from "./random.js";

const draw = (rng: () => number, count: number) => Array.from({ length: count }, () => rng());

describe("the demo's random numbers", () => {
  it("give the same sequence for the same seed, in [0, 1)", () => {
    const first = draw(mulberry32(42), 5);
    expect(draw(mulberry32(42), 5)).toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(draw(mulberry32(43), 5)).not.toEqual(first);
  });

  it("give each key its own stream, whatever was drawn from another first", () => {
    const alone = draw(stream(42, "SPY"), 5);
    draw(stream(42, "QQQ"), 50);
    expect(draw(stream(42, "SPY"), 5)).toEqual(alone);
    expect(draw(stream(42, "QQQ"), 5)).not.toEqual(alone);
  });

  it("draw integers, normals, picks and weighted picks", () => {
    const rng = mulberry32(7);
    const ints = new Set(Array.from({ length: 1_000 }, () => int(rng, 1, 3)));
    expect([...ints].sort()).toEqual([1, 2, 3]);
    const normals = Array.from({ length: 5_000 }, () => normal(rng));
    const mean = normals.reduce((sum, value) => sum + value, 0) / normals.length;
    const sd = Math.sqrt(normals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / normals.length);
    expect(Math.abs(mean)).toBeLessThan(0.1);
    expect(Math.abs(sd - 1)).toBeLessThan(0.1);
    for (let index = 0; index < 100; index++) {
      expect(
        weighted(rng, [
          ["never", 0],
          ["always", 1],
        ] as const),
      ).toBe("always");
      const value = uniform(rng, 2, 3);
      expect(value >= 2 && value < 3).toBe(true);
      expect(["a", "b"]).toContain(pick(rng, ["a", "b"]));
    }
    expect(chance(rng, 0)).toBe(false);
    expect(chance(rng, 1)).toBe(true);
  });
});
