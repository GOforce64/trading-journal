import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";

describe("the test run's temp folder", () => {
  it("is the run's own, which the run removes, so temp journals don't pile up", () => {
    expect(basename(tmpdir())).toMatch(/^tj-test-run-/);
    expect(dirname(tmpdir())).not.toBe(tmpdir());
  });
});
