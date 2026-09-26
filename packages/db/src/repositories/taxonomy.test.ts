import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { createTaxonomyRepo } from "./taxonomy.js";

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

describe("taxonomy repository", () => {
  let db: Db;
  const repo = () => createTaxonomyRepo(db, () => 1_000);

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-tax-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
  });

  it("creates and lists setups", () => {
    const created = repo().createSetup({ name: "Earnings IV crush", strategy: "iron_fly" });
    expect(created.name).toBe("Earnings IV crush");
    expect(repo().listSetups()).toHaveLength(1);
  });

  it("creates tags of both kinds", () => {
    repo().createTag({ name: "Moved stop", kind: "mistake" });
    repo().createTag({ name: "Calm", kind: "emotion" });
    expect(
      repo()
        .listTags()
        .map((tag) => tag.kind)
        .sort(),
    ).toEqual(["emotion", "mistake"]);
  });

  it("allows the same name in different kinds", () => {
    repo().createTag({ name: "Rushed", kind: "mistake" });
    expect(() => repo().createTag({ name: "Rushed", kind: "emotion" })).not.toThrow();
  });

  it("rejects a duplicate tag name within the same kind", () => {
    repo().createTag({ name: "FOMO entry", kind: "mistake" });
    expect(() => repo().createTag({ name: "FOMO entry", kind: "mistake" })).toThrow();
  });

  it("seeds defaults once and is idempotent", () => {
    repo().seedDefaults();
    const afterFirst = repo().listTags().length;
    repo().seedDefaults();
    expect(repo().listTags()).toHaveLength(afterFirst);
    expect(afterFirst).toBeGreaterThan(0);
    expect(repo().listSetups().length).toBeGreaterThan(0);
  });

  it("does not seed over setups the user already made", () => {
    repo().createSetup({ name: "My own setup" });
    repo().seedDefaults();
    expect(repo().listSetups()).toHaveLength(1);
  });
});
