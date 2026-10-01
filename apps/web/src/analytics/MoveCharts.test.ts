import { describe, expect, it } from "vitest";
import { pickLabels } from "./MoveCharts.js";

const dot = (id: string, x: number, y: number, pnl: number) => ({ id, x, y, pnl });

describe("pickLabels", () => {
  it("names the five largest results, skipping one that would sit on a name already placed", () => {
    // CRM and CRWD sit a point apart on a 30% chart: only the bigger result gets its name.
    const dots = [
      dot("crm", 4, 19, -900),
      dot("crwd", 5, 18, -800),
      dot("bull", 6, 13, -700),
      dot("nio", 9, 7, 600),
      dot("ai", 12, 3, 500),
      dot("zz", 20, 20, 400),
      dot("small", 25, 2, 10),
    ];
    expect([...pickLabels(dots, 30)].sort()).toEqual(["ai", "bull", "crm", "nio", "zz"]);
  });

  it("names none without dots", () => {
    expect(pickLabels([], 30).size).toBe(0);
  });
});
