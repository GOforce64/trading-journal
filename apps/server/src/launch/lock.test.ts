import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAlive, refreshLock, releaseLock, takeLock } from "./lock.js";

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

  it("is taken over when it can't be read and is a minute old", () => {
    const file = lockIn();
    writeFileSync(file, "garbage");
    const now = Date.now();
    utimesSync(file, (now - 61_000) / 1000, (now - 61_000) / 1000);
    expect(takeLock(file, now, alive, 32)).toBe(true);
  });

  it("is refused when it can't be read yet: another click is still writing it (launcher spec §14)", () => {
    const file = lockIn();
    writeFileSync(file, "");
    expect(takeLock(file, Date.now(), alive, 32)).toBe(false);
  });

  it("isn't taken from a click that took it over first (launcher spec §14)", () => {
    const file = lockIn();
    writeFileSync(file, JSON.stringify({ pid: 31, at: 1000 }));
    // While this click finds 31 gone, another click takes the stale lock over.
    const gone = (pid: number) => {
      if (pid === 31) writeFileSync(file, JSON.stringify({ pid: 33, at: 1000 }));
      return false;
    };
    expect(takeLock(file, 1000, gone, 32)).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ pid: 33, at: 1000 });
  });

  it("stays fresh while its click refreshes it, through a long install (launcher spec §14)", () => {
    const file = lockIn();
    takeLock(file, 0, alive, 31);
    refreshLock(file, 50_000, 31);
    expect(takeLock(file, 100_000, alive, 32)).toBe(false);
    // A refresh never touches another click's lock.
    refreshLock(file, 200_000, 99);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ pid: 31, at: 50_000 });
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
