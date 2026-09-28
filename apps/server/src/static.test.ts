import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, runMigrations } from "@tj/db";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));

function appWithWeb() {
  const root = mkdtempSync(join(tmpdir(), "tj-static-"));
  const webDir = join(root, "web");
  mkdirSync(join(webDir, "assets"), { recursive: true });
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>Journal</title>");
  writeFileSync(join(webDir, "assets", "app.js"), "console.log('app');");
  const file = join(root, "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  return createApp({ db: openDatabase(file), webDir });
}

const LOCAL = { host: "localhost" };

describe("static hosting", () => {
  it("serves index.html at the root", async () => {
    const res = await appWithWeb().request("/", { headers: LOCAL });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Journal");
  });

  it("serves built assets", async () => {
    const res = await appWithWeb().request("/assets/app.js", { headers: LOCAL });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.log");
  });

  it("falls back to index.html for client-side routes", async () => {
    const res = await appWithWeb().request("/trades/abc", { headers: LOCAL });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Journal");
  });

  it("still 404s unknown API routes rather than serving HTML", async () => {
    const res = await appWithWeb().request("/api/nope", { headers: LOCAL });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  it("keeps the API working alongside the UI", async () => {
    const res = await appWithWeb().request("/api/health", { headers: LOCAL });
    expect(res.status).toBe(200);
  });
});
