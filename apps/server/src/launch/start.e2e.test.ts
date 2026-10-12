import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { pollUntil, probe, startServer } from "./effects.js";
import { isAlive } from "./lock.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

describe("the launcher's start", () => {
  it("starts a real server that answers with its process, and stops it on request", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tj-launch-"));
    const port = await freePort();
    const pid = startServer({ repo: REPO, dataDir, port, node: process.execPath });
    try {
      const up = await pollUntil(async () => {
        const found = await probe(port);
        return found.kind === "journal" && found.pid === pid;
      }, 30_000);
      expect(up).toBe(true);
      const res = await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(await pollUntil(async () => (await probe(port)).kind === "down", 10_000)).toBe(true);
      await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 5000 });
    } finally {
      if (isAlive(pid)) process.kill(pid);
      // After the process is gone: Windows won't delete a folder a running process holds.
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});
