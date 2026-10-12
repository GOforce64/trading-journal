import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { browserCommand, journalUrl, pollUntil, probe } from "./effects.js";

async function serving(body: string | null) {
  const server = createServer((_req, res) => {
    if (body == null) return; // never answers
    res.setHeader("content-type", "application/json");
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

describe("the health probe", () => {
  it("knows the journal and its process", async () => {
    const { server, port } = await serving(JSON.stringify({ ok: true, app: "trading-journal", pid: 9 }));
    expect(await probe(port)).toEqual({ kind: "journal", pid: 9 });
    server.close();
  });

  it("takes an older journal's bare { ok: true } as the journal, with no process", async () => {
    const { server, port } = await serving(JSON.stringify({ ok: true }));
    expect(await probe(port)).toEqual({ kind: "journal", pid: null });
    server.close();
  });

  it("calls anything else on the port another program", async () => {
    const { server, port } = await serving("<html>hello</html>");
    expect(await probe(port)).toEqual({ kind: "other" });
    server.close();
  });

  it("calls a port that never answers another program", async () => {
    const { server, port } = await serving(null);
    expect(await probe(port, 200)).toEqual({ kind: "other" });
    server.closeAllConnections();
    server.close();
  });

  it("calls a closed port down", async () => {
    const { server, port } = await serving("{}");
    await new Promise((resolve) => server.close(resolve));
    expect(await probe(port)).toEqual({ kind: "down" });
  });
});

describe("the rest", () => {
  it("polls until a check passes, or gives up", async () => {
    let count = 0;
    expect(
      await pollUntil(
        async () => ++count === 3,
        1000,
        () => false,
        5,
      ),
    ).toBe(true);
    expect(
      await pollUntil(
        async () => false,
        1000,
        () => true,
        5,
      ),
    ).toBe(false);
  });

  it("opens the default browser on each system", () => {
    const url = journalUrl(4178);
    expect(url).toBe("http://127.0.0.1:4178/");
    expect(browserCommand(url, "linux")).toEqual({ command: "xdg-open", args: [url], verbatim: false });
    expect(browserCommand(url, "darwin")).toEqual({ command: "open", args: [url], verbatim: false });
    expect(browserCommand(url, "win32")).toEqual({
      command: "cmd",
      args: ["/c", `start "" "${url}"`],
      verbatim: true,
    });
  });
});
