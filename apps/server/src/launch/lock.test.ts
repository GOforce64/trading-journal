import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAlive, releaseLock, takeLock } from "./lock.js";

const lockIn = () => join(mkdtempSync(join(tmpdir(), "tj-lock-")), "launch.lock");
const alive = () => true;

describe("the click's lock", () => {
  it("is taken when free, with this process in it", () => {
    const file = lockIn();
    expect(takeLock(file, 1000, alive, 31)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ pid: 31, at: 1000 });
  });

  it("is refused while another click holds it", () => {
    const file = lockIn();
    takeLock(file, 1000, alive, 31);
    expect(takeLock(file, 30_000, alive, 32)).toBe(false);
  });

  it("is taken over after a minute", () => {
    const file = lockIn();
    takeLock(file, 1000, alive, 31);
    expect(takeLock(file, 62_000, alive, 32)).toBe(true);
  });

  it("is taken over when its process is gone", () => {
    const file = lockIn();
    takeLock(file, 1000, alive, 31);
    expect(takeLock(file, 2000, () => false, 32)).toBe(true);
  });

  it("is taken over when it can't be read", () => {
    const file = lockIn();
    writeFileSync(file, "garbage");
    expect(takeLock(file, 1000, alive, 32)).toBe(true);
  });

  it("is free again once released", () => {
    const file = lockIn();
    takeLock(file, 1000, alive, 31);
    releaseLock(file);
    releaseLock(file);
    expect(takeLock(file, 1500, alive, 32)).toBe(true);
  });

  it("knows this process is alive", () => {
    expect(isAlive(process.pid)).toBe(true);
  });
});
