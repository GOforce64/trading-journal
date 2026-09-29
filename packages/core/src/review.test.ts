import { describe, expect, it } from "vitest";
import { type ReviewInput, reviewStatus } from "./review.js";

/** A closed scalp with nothing reviewed yet. */
const scalp: ReviewInput = {
  strategy: "scalp",
  book: "paper",
  closedAt: 1_790_603_172_000,
  excluded: false,
  reviewedAt: null,
  setupId: null,
  grade: null,
  scalp: null,
};

describe("reviewStatus", () => {
  it("keeps a closed scalp in the queue, saying what it lacks, in the order setup, grade, stop", () => {
    expect(reviewStatus(scalp)).toEqual({ status: "pending", missing: ["setup", "grade", "stop"] });
    expect(reviewStatus({ ...scalp, grade: "B" })).toEqual({ status: "pending", missing: ["setup", "stop"] });
    expect(reviewStatus({ ...scalp, setupId: "s1", scalp: { stopPrice: null } })).toEqual({
      status: "pending",
      missing: ["grade", "stop"],
    });
  });

  it("lets a scalp out once it has a setup, a grade and a stop, on either basis", () => {
    expect(reviewStatus({ ...scalp, setupId: "s1", grade: "A", scalp: { stopPrice: 231.8 } })).toEqual({
      status: "done",
      missing: [],
    });
    // A premium stop of 0 means "let it ride to zero", and still counts as a stop.
    expect(reviewStatus({ ...scalp, setupId: "s1", grade: "A", scalp: { stopPrice: 0 } })?.status).toBe(
      "done",
    );
  });

  it("lets a scalp out on Done reviewing, still saying what it lacks", () => {
    expect(reviewStatus({ ...scalp, reviewedAt: 5_000, grade: "C" })).toEqual({
      status: "done",
      missing: ["setup", "stop"],
    });
  });

  it("doesn't apply to a fly, a missed trade, an open scalp or an excluded one", () => {
    expect(reviewStatus({ ...scalp, strategy: "iron_fly" })).toBeNull();
    expect(reviewStatus({ ...scalp, book: "missed" })).toBeNull();
    expect(reviewStatus({ ...scalp, closedAt: null })).toBeNull();
    expect(reviewStatus({ ...scalp, excluded: true })).toBeNull();
  });
});
