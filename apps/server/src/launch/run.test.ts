import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runLaunch } from "./run.js";

const dataDir = () => mkdtempSync(join(tmpdir(), "tj-run-"));
const argv = (dir: string) => ["--pnpm", "/bin/pnpm", "--data-dir", dir];
const base = { exists: () => true, now: () => 1000, effects: () => ({}) as never };

describe("runLaunch", () => {
  it("opens the error page when pnpm has moved", async () => {
    const dir = dataDir();
    const open = vi.fn();
    expect(await runLaunch(argv(dir), {}, { ...base, exists: () => false, open })).toBe(1);
    expect(readFileSync(join(dir, "launch-error.html"), "utf8")).toContain(
      "Node (or pnpm) is no longer at /bin/pnpm",
    );
    expect(open.mock.calls[0]?.[0]).toMatch(/^file:\/\/.*launch-error\.html$/);
  });

  it("opens the error page for an unexpected error, and releases the lock", async () => {
    const dir = dataDir();
    const open = vi.fn();
    const click = vi.fn(async () => {
      throw new Error("EPERM: operation not permitted, rename 'server.log'");
    });
    expect(await runLaunch(argv(dir), {}, { ...base, click, open })).toBe(1);
    expect(readFileSync(join(dir, "launch-error.html"), "utf8")).toContain(
      "The journal didn't open: EPERM: operation not permitted, rename 'server.log'",
    );
    expect(open).toHaveBeenCalledOnce();
    expect(existsSync(join(dir, "launch.lock"))).toBe(false);
  });

  it("leaves the browser to a click already starting the journal", async () => {
    const dir = dataDir();
    const click = vi.fn(async () => ({ kind: "opened" as const, started: true, restarted: false }));
    const slow = runLaunch(
      argv(dir),
      {},
      {
        ...base,
        open: vi.fn(),
        click: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { kind: "opened", started: true, restarted: false };
        },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await runLaunch(argv(dir), {}, { ...base, click, open: vi.fn() })).toBe(0);
    expect(click).not.toHaveBeenCalled();
    expect(await slow).toBe(0);
  });

  it("keeps its lock fresh through a long install, so a later click doesn't start a second (launcher spec §14)", async () => {
    const dir = dataDir();
    let clock = 1000;
    const slow = runLaunch(
      argv(dir),
      {},
      {
        ...base,
        now: () => clock,
        refreshEveryMs: 10,
        open: vi.fn(),
        click: async () => {
          await new Promise((resolve) => setTimeout(resolve, 120));
          return { kind: "opened", started: true, restarted: false };
        },
      },
    );
    // More than a minute into pnpm install.
    clock += 70_000;
    await new Promise((resolve) => setTimeout(resolve, 40));
    const click = vi.fn(async () => ({ kind: "opened" as const, started: true, restarted: false }));
    expect(await runLaunch(argv(dir), {}, { ...base, now: () => clock, click, open: vi.fn() })).toBe(0);
    expect(click).not.toHaveBeenCalled();
    expect(await slow).toBe(0);
  });

  it("opens the error page for a failed click", async () => {
    const dir = dataDir();
    const open = vi.fn();
    const click = async () => ({
      kind: "failed" as const,
      failure: { kind: "port-taken" as const, port: 4178 },
    });
    expect(await runLaunch(argv(dir), {}, { ...base, click, open })).toBe(1);
    expect(readFileSync(join(dir, "launch-error.html"), "utf8")).toContain(
      "Port 4178 is used by another program",
    );
  });
});
