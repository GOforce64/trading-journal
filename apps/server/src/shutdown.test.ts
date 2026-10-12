import { describe, expect, it, vi } from "vitest";
import { LOCAL, testApp } from "./testing.js";

describe("health and shutdown", () => {
  it("names the app and its process", async () => {
    const res = await testApp({ pid: 4242 }).request("/api/health", { headers: LOCAL });
    expect(await res.json()).toEqual({ ok: true, app: "trading-journal", pid: 4242 });
  });

  it("answers, then stops once", async () => {
    const shutdown = vi.fn();
    const app = testApp({ shutdown });
    const res = await app.request("/api/shutdown", { method: "POST", headers: LOCAL });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());
  });

  it("isn't there without a way to stop", async () => {
    const res = await testApp().request("/api/shutdown", { method: "POST", headers: LOCAL });
    expect(res.status).toBe(404);
  });

  it("refuses another site", async () => {
    const shutdown = vi.fn();
    const res = await testApp({ shutdown }).request("/api/shutdown", {
      method: "POST",
      headers: { ...LOCAL, "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shutdown).not.toHaveBeenCalled();
  });
});
