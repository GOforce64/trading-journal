import { describe, expect, it } from "vitest";
import { type ClickEffects, click, type LaunchState } from "./click.js";

function fakes(overrides: Partial<ClickEffects> = {}) {
  const calls: string[] = [];
  const fx: ClickEffects = {
    probe: async () => ({ kind: "down" }),
    head: async () => "abc",
    readState: () => null,
    writeState: (state) => {
      calls.push(`write ${state.pid} ${state.head}`);
    },
    stop: async () => {
      calls.push("stop");
      return true;
    },
    update: async () => {
      calls.push("update");
      return { ok: true, output: "" };
    },
    start: () => {
      calls.push("start");
      return 777;
    },
    waitUp: async (pid) => {
      calls.push(`wait ${pid}`);
      return true;
    },
    openBrowser: () => {
      calls.push("open");
    },
    now: () => 1000,
    ...overrides,
  };
  return { fx, calls };
}
const ours = (head: string | null): LaunchState => ({ pid: 55, head, port: 4178, startedAt: 1 });
const up = async () => ({ kind: "journal" as const, pid: 55 });

describe("a click", () => {
  it("starts a journal that's down, then opens the browser", async () => {
    const { fx, calls } = fakes();
    expect(await click(fx, 4178)).toEqual({ kind: "opened", started: true, restarted: false });
    expect(calls).toEqual(["update", "start", "write 777 abc", "wait 777", "open"]);
  });

  it("only opens the browser when the journal is up on the same commit", async () => {
    const { fx, calls } = fakes({ probe: up, readState: () => ours("abc") });
    expect(await click(fx, 4178)).toEqual({ kind: "opened", started: false, restarted: false });
    expect(calls).toEqual(["open"]);
  });

  it("restarts a server it started on an older commit", async () => {
    const { fx, calls } = fakes({ probe: up, readState: () => ours("old") });
    expect(await click(fx, 4178)).toEqual({ kind: "opened", started: true, restarted: true });
    expect(calls).toEqual(["stop", "update", "start", "write 777 abc", "wait 777", "open"]);
  });

  const cases: [string, () => LaunchState | null, () => Promise<string | null>][] = [
    ["it didn't start it", () => null, async () => "abc"],
    ["there's no git", () => ours("old"), async () => null],
  ];
  it.each(cases)("leaves a running journal alone when %s", async (_, readState, head) => {
    const { fx, calls } = fakes({ probe: up, readState, head });
    await click(fx, 4178);
    expect(calls).toEqual(["open"]);
  });

  it("leaves alone a journal that doesn't give its process", async () => {
    const { fx, calls } = fakes({
      probe: async () => ({ kind: "journal", pid: null }),
      readState: () => ours("old"),
    });
    await click(fx, 4178);
    expect(calls).toEqual(["open"]);
  });

  it("fails when another program has the port", async () => {
    const { fx, calls } = fakes({ probe: async () => ({ kind: "other" }) });
    expect(await click(fx, 4199)).toEqual({ kind: "failed", failure: { kind: "port-taken", port: 4199 } });
    expect(calls).toEqual([]);
  });

  it("fails when the update fails, without starting", async () => {
    const { fx, calls } = fakes({
      update: async () => ({ ok: false, output: "ERR_PNPM_OUTDATED_LOCKFILE" }),
    });
    expect(await click(fx, 4178)).toEqual({
      kind: "failed",
      failure: { kind: "update-failed", output: "ERR_PNPM_OUTDATED_LOCKFILE" },
    });
    expect(calls).toEqual([]);
  });

  it("fails when the server doesn't come up", async () => {
    const { fx } = fakes({ waitUp: async () => false });
    expect(await click(fx, 4178)).toEqual({ kind: "failed", failure: { kind: "not-started" } });
  });

  it("fails when the old server is still busy, without updating", async () => {
    const { fx, calls } = fakes({ probe: up, readState: () => ours("old"), stop: async () => false });
    expect(await click(fx, 4178)).toEqual({ kind: "failed", failure: { kind: "still-busy" } });
    expect(calls).toEqual([]);
  });
});
