import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dataPaths, readSecrets, resolveDataDir } from "./config.js";

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

describe("readSecrets", () => {
  const secretsFile = (contents?: string) => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-secrets-")), "secrets.json");
    if (contents !== undefined) writeFileSync(file, contents);
    return file;
  };

  it("has no keys when the file does not exist", () => {
    expect(readSecrets(secretsFile())).toEqual({});
  });

  it("reads the Alpaca key", () => {
    const file = secretsFile(JSON.stringify({ alpaca: { keyId: "PKTEST", secretKey: "shh-secret" } }));
    expect(readSecrets(file)).toEqual({ alpaca: { keyId: "PKTEST", secretKey: "shh-secret" } });
  });

  it("refuses a file that is not JSON without repeating what it holds", () => {
    // Node's own parse error would quote the text around the mistake: the secret itself.
    const file = secretsFile('{"alpaca": {"keyId": "PKTEST", "secretKey": shh-secret}}');
    expect(() => readSecrets(file)).toThrow(/not valid JSON/);
    expect(() => readSecrets(file)).not.toThrow(/shh-secret/);
  });

  it("names the field that is missing from the Alpaca entry", () => {
    const file = secretsFile(JSON.stringify({ alpaca: { keyId: "PKTEST" } }));
    expect(() => readSecrets(file)).toThrow(/alpaca\.secretKey/);
    expect(() => readSecrets(file)).not.toThrow(/PKTEST/);
  });
});
