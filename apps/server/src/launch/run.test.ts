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

  it("releases the lock even when the click throws", async () => {
    const dir = dataDir();
    const click = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(runLaunch(argv(dir), {}, { ...base, click, open: vi.fn() })).rejects.toThrow("boom");
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
