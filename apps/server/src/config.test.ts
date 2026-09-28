import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dataPaths, readSecrets, resolveDataDir, SecretsFileBroken, writeAlpacaKeys } from "./config.js";

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

describe("writeAlpacaKeys", () => {
  const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
  const place = (contents?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "tj-secrets-"));
    const file = join(dir, "secrets.json");
    if (contents !== undefined) writeFileSync(file, contents);
    return { dir, file };
  };
  const onWindows = process.platform === "win32";

  it("creates the file with the key", () => {
    const { file } = place();
    writeAlpacaKeys(file, KEYS);
    expect(readSecrets(file)).toEqual({ alpaca: KEYS });
  });

  it.skipIf(onWindows)("makes the file readable by its owner only", () => {
    const { file } = place();
    writeAlpacaKeys(file, KEYS);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it.skipIf(onWindows)("tightens a hand-made file that others could read", () => {
    const { file } = place(JSON.stringify({ alpaca: { keyId: "PKOLD", secretKey: "old" } }));
    writeAlpacaKeys(file, KEYS);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("replaces the old key and keeps entries it does not know", () => {
    const { file } = place(
      JSON.stringify({ ibkr: { flexToken: "keep-me" }, alpaca: { keyId: "PKOLD", secretKey: "old" } }),
    );
    writeAlpacaKeys(file, KEYS);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ibkr: { flexToken: "keep-me" }, alpaca: KEYS });
  });

  it("removes the key and keeps the rest", () => {
    const { file } = place(JSON.stringify({ ibkr: { flexToken: "keep-me" }, alpaca: KEYS }));
    writeAlpacaKeys(file, null);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ibkr: { flexToken: "keep-me" } });
  });

  it("refuses to overwrite a file it cannot read, without repeating what it holds", () => {
    const broken = '{"ibkr": {"flexToken": shh-token}}';
    const { file } = place(broken);
    expect(() => writeAlpacaKeys(file, KEYS)).toThrow(SecretsFileBroken);
    expect(() => writeAlpacaKeys(file, KEYS)).not.toThrow(/shh-token/);
    expect(readFileSync(file, "utf8")).toBe(broken);
  });

  it("refuses a file that holds something other than an object", () => {
    const { file } = place("[]");
    expect(() => writeAlpacaKeys(file, KEYS)).toThrow(SecretsFileBroken);
  });

  it("leaves no temporary file behind", () => {
    const { dir, file } = place();
    writeAlpacaKeys(file, KEYS);
    expect(readdirSync(dir)).toEqual(["secrets.json"]);
  });
});
