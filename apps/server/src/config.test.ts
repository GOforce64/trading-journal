import { describe, expect, it } from "vitest";
import { dataPaths, resolveDataDir } from "./config.js";

describe("resolveDataDir", () => {
  it("prefers TJ_DATA_DIR", () => {
    expect(resolveDataDir({ TJ_DATA_DIR: "/custom/spot" }, "linux", "/home/t")).toBe("/custom/spot");
  });

  it("uses XDG_DATA_HOME on Linux", () => {
    expect(resolveDataDir({ XDG_DATA_HOME: "/home/t/.local/share" }, "linux", "/home/t")).toBe(
      "/home/t/.local/share/trading-journal",
    );
  });

  it("falls back to ~/.local/share on Linux", () => {
    expect(resolveDataDir({}, "linux", "/home/t")).toBe("/home/t/.local/share/trading-journal");
  });

  it("uses APPDATA on Windows", () => {
    expect(resolveDataDir({ APPDATA: "C:\\Users\\t\\AppData\\Roaming" }, "win32", "C:\\Users\\t")).toBe(
      "C:\\Users\\t\\AppData\\Roaming\\trading-journal",
    );
  });
});

describe("dataPaths", () => {
  it("names every file inside the data directory", () => {
    const paths = dataPaths("/data/tj");
    expect(paths.dbFile.endsWith("journal.db")).toBe(true);
    expect(paths.backupDir.endsWith("backups")).toBe(true);
    expect(paths.attachmentsDir.endsWith("attachments")).toBe(true);
    expect(paths.secretsFile.endsWith("secrets.json")).toBe(true);
    expect(paths.dataDir).toBe("/data/tj");
  });
});
