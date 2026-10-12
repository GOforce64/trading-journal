import { describe, expect, it } from "vitest";
import { errorPage, failureReason, tail } from "./errorPage.js";

describe("the error page", () => {
  it.each([
    [
      { kind: "port-taken" as const, port: 4178 },
      "Port 4178 is used by another program. Close it, or set TJ_PORT and run `pnpm launcher:install` again.",
    ],
    [{ kind: "update-failed" as const, output: "" }, "Updating the journal failed"],
    [{ kind: "not-started" as const }, "The journal didn't start"],
    [
      { kind: "still-busy" as const },
      "The journal is finishing a sync before it restarts with your update. Click the icon again in a minute.",
    ],
    [
      { kind: "tool-missing" as const, path: "/opt/pnpm" },
      "Node (or pnpm) is no longer at /opt/pnpm. Run `pnpm launcher:install` again.",
    ],
  ])("says why: %o", (failure, reason) => {
    expect(failureReason(failure)).toBe(reason);
  });

  it("keeps the last 40 lines", () => {
    const log = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(tail(`${log}\n`).split("\n")).toEqual(Array.from({ length: 40 }, (_, i) => `line ${i + 11}`));
  });

  it("shows the log's end, escaped, and the update's own output when that failed", () => {
    const page = errorPage({ kind: "not-started" }, "Error: <boom> & more");
    expect(page).toContain("<h1>The journal didn't start</h1>");
    expect(page).toContain("Error: &lt;boom&gt; &amp; more");
    expect(page).toContain("pnpm start");
    const update = errorPage({ kind: "update-failed", output: "ERR_PNPM" }, "server log");
    expect(update).toContain("ERR_PNPM");
    expect(update).not.toContain("server log");
  });
});
