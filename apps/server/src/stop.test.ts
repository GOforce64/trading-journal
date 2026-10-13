import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { stopWhenIdle } from "./stop.js";

describe("stopWhenIdle", () => {
  it("lets a request in flight finish, then stops and calls done", async () => {
    const server = createServer((_req, res) => {
      setTimeout(() => res.end("done"), 300);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const reply = fetch(`http://127.0.0.1:${port}/`).then((res) => res.text());
    await new Promise((resolve) => setTimeout(resolve, 50));
    const done = vi.fn();
    stopWhenIdle(server, done, 20);
    expect(await reply).toBe("done");
    await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });
});
