import { describe, expect, it } from "vitest";
import { queueNav } from "./queue.js";

const item = (id: string, minute: number) => ({ id, openedAt: Date.UTC(2026, 8, 28, 13, 30 + minute) });
const A = item("a", 1);
const B = item("b", 5);
const C = item("c", 9);
const PENDING = [A, B, C];

describe("queueNav", () => {
  it("places a pending trade in the queue, with the way on both sides", () => {
    expect(queueNav(PENDING, B, true)).toEqual({ position: 2, total: 3, left: 2, next: "c", prev: "a" });
  });

  it("wraps around at both ends", () => {
    expect(queueNav(PENDING, C, true)).toMatchObject({ position: 3, next: "a", prev: "b" });
    expect(queueNav(PENDING, A, true)).toMatchObject({ position: 1, next: "b", prev: "c" });
  });

  it("goes by the trade's own status when the list hasn't caught up with its save", () => {
    // B was just reviewed, but the list was fetched before that landed.
    expect(queueNav(PENDING, B, false)).toEqual({ position: null, total: 2, left: 2, next: "c", prev: "a" });
    // And a pending trade the list doesn't have yet still counts.
    expect(queueNav([A, C], B, true)).toMatchObject({ position: 2, total: 3, left: 2 });
  });

  it("leads from a trade outside the queue to the next one opened after it", () => {
    expect(queueNav(PENDING, item("x", 3), false)).toMatchObject({
      position: null,
      left: 3,
      next: "b",
      prev: "a",
    });
  });

  it("has no way on when nothing else waits", () => {
    expect(queueNav([A], A, true)).toEqual({ position: 1, total: 1, left: 0, next: null, prev: null });
    expect(queueNav([], B, false)).toEqual({ position: null, total: 0, left: 0, next: null, prev: null });
  });

  it("orders trades opened in the same minute by id", () => {
    const twin = { id: "b2", openedAt: B.openedAt };
    expect(queueNav([A, twin, B, C], B, true)).toMatchObject({ position: 2, next: "b2" });
  });
});
