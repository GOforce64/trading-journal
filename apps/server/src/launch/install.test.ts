import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  desktopEntry,
  execArg,
  findOnPath,
  installLauncher,
  type LauncherSetup,
  launcherFile,
  removeLauncher,
  shortcutScript,
  stableNode,
  winArg,
} from "./install.js";

const LINUX: LauncherSetup = {
  node: "/usr/bin/node",
  pnpm: "/home/u/.local/bin/pnpm",
  repo: "/home/u/Projects/TradingJournal",
  dataDir: null,
  port: null,
};
const WINDOWS: LauncherSetup = {
  node: "C:\\Program Files\\nodejs\\node.exe",
  pnpm: "C:\\Users\\G Z\\AppData\\Local\\pnpm\\pnpm.exe",
  repo: "C:\\Users\\G Z\\Projects\\TradingJournal",
  dataDir: null,
  port: 4300,
};

describe("the Fedora entry", () => {
  it("runs the launcher from apps/server with the recorded node and pnpm", () => {
    expect(desktopEntry(LINUX)).toBe(
      [
        "[Desktop Entry]",
        "Type=Application",
        "Name=Trading Journal",
        "Comment=Open your trading journal",
        'Exec="/usr/bin/node" "--import" "tsx" "src/launch/main.ts" "--pnpm" "/home/u/.local/bin/pnpm"',
        "Path=/home/u/Projects/TradingJournal/apps/server",
        "Icon=/home/u/Projects/TradingJournal/apps/web/public/icon-256.png",
        "Terminal=false",
        "Categories=Office;Finance;",
        "StartupNotify=false",
        "",
      ].join("\n"),
    );
  });

  it("escapes what the desktop entry spec asks", () => {
    expect(execArg('/a "b"$c%')).toBe(String.raw`"/a \\"b\\"\\$c%%"`);
    expect(execArg("/a\\b")).toBe(String.raw`"/a\\\\b"`);
  });
});

describe("the Windows shortcut", () => {
  it("is made by PowerShell, minimized, with the icon", () => {
    const script = shortcutScript(WINDOWS, "C:\\Users\\G Z\\Start Menu\\Trading Journal.lnk");
    expect(script).toContain("CreateShortcut('C:\\Users\\G Z\\Start Menu\\Trading Journal.lnk')");
    expect(script).toContain("$s.TargetPath = 'C:\\Program Files\\nodejs\\node.exe'");
    expect(script).toContain(
      `$s.Arguments = '--import tsx src/launch/main.ts --pnpm "C:\\Users\\G Z\\AppData\\Local\\pnpm\\pnpm.exe" --port 4300'`,
    );
    expect(script).toContain(
      "$s.WorkingDirectory = 'C:\\Users\\G Z\\Projects\\TradingJournal\\apps\\server'",
    );
    expect(script).toContain(
      "$s.IconLocation = 'C:\\Users\\G Z\\Projects\\TradingJournal\\apps\\web\\public\\icon.ico'",
    );
    expect(script).toContain("$s.WindowStyle = 7");
  });

  it("quotes arguments and PowerShell strings safely", () => {
    expect(winArg("plain")).toBe("plain");
    expect(winArg("has space")).toBe('"has space"');
    expect(winArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(shortcutScript({ ...WINDOWS, node: "C:\\O'Neil\\node.exe" }, "x.lnk")).toContain(
      "'C:\\O''Neil\\node.exe'",
    );
  });
});

describe("where it goes", () => {
  it("is the app menu on Fedora and the Start menu on Windows", () => {
    expect(launcherFile("linux", {}, "/home/u")).toBe(
      "/home/u/.local/share/applications/trading-journal.desktop",
    );
    expect(launcherFile("linux", { XDG_DATA_HOME: "/x" }, "/home/u")).toBe(
      "/x/applications/trading-journal.desktop",
    );
    expect(launcherFile("win32", { APPDATA: "C:\\Users\\G\\AppData\\Roaming" }, "C:\\Users\\G")).toBe(
      "C:\\Users\\G\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Trading Journal.lnk",
    );
    expect(launcherFile("darwin", {}, "/Users/g")).toBeNull();
  });

  it("finds pnpm on the PATH", () => {
    const have = new Set(["/b/pnpm", "C:\\pn\\pnpm.cmd"]);
    expect(findOnPath("pnpm", { PATH: "/a:/b" }, "linux", (path) => have.has(path))).toBe("/b/pnpm");
    expect(
      findOnPath("pnpm", { PATH: "C:\\x;C:\\pn", PATHEXT: ".EXE;.CMD" }, "win32", (path) => have.has(path)),
    ).toBe("C:\\pn\\pnpm.cmd");
    expect(findOnPath("pnpm", { PATH: "/a" }, "linux", () => false)).toBeNull();
  });
});

describe.runIf(process.platform === "linux")("on Linux, for real", () => {
  it("writes and removes the entry", () => {
    const env = { XDG_DATA_HOME: mkdtempSync(join(tmpdir(), "tj-xdg-")) };
    const file = installLauncher(LINUX, "linux", env, "/home/u");
    expect(readFileSync(file, "utf8")).toBe(desktopEntry(LINUX));
    expect(removeLauncher("linux", env, "/home/u")).toBe(file);
    expect(existsSync(file)).toBe(false);
  });
});

describe.runIf(process.platform === "win32")("on Windows, for real", () => {
  it("makes a shortcut PowerShell can read back, and removes it", () => {
    const env = { APPDATA: mkdtempSync(join(tmpdir(), "tj-appdata-")) };
    const setup = { ...WINDOWS, node: process.execPath };
    const file = installLauncher(setup, "win32", env, "C:\\Users\\G");
    const read = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${file}'); $s.TargetPath; $s.Arguments; $s.WorkingDirectory`,
      ],
      { encoding: "utf8" },
    );
    // The quoted pnpm path with its space survives the round trip, as a click passes it to node.
    expect(read.stdout.trim().split(/\r?\n/)).toEqual([
      process.execPath,
      '--import tsx src/launch/main.ts --pnpm "C:\\Users\\G Z\\AppData\\Local\\pnpm\\pnpm.exe" --port 4300',
      "C:\\Users\\G Z\\Projects\\TradingJournal\\apps\\server",
    ]);
    expect(removeLauncher("win32", env, "C:\\Users\\G")).toBe(file);
    expect(existsSync(file)).toBe(false);
    // Two cold PowerShell starts (make, then read back) take longer than vitest's 5 s on a CI runner.
  }, 60_000);
});

describe("stableNode (launcher spec §14)", () => {
  // Fedora's /usr/bin/node is a link to /usr/bin/node-22, and process.execPath is the versioned file: an upgrade that
  // drops node-22 would leave the icon pointing at nothing.
  it.skipIf(process.platform === "win32")("records the PATH's node when it's the same binary", () => {
    const root = mkdtempSync(join(tmpdir(), "tj-node-"));
    mkdirSync(join(root, "lib"));
    mkdirSync(join(root, "bin"));
    const versioned = join(root, "lib", "node-22");
    writeFileSync(versioned, "");
    symlinkSync(versioned, join(root, "bin", "node"));
    expect(stableNode(versioned, { PATH: join(root, "bin") }, "linux")).toBe(join(root, "bin", "node"));
  });

  it.skipIf(process.platform === "win32")("keeps this node when the PATH's is another one", () => {
    const root = mkdtempSync(join(tmpdir(), "tj-node-"));
    mkdirSync(join(root, "bin"));
    const mine = join(root, "node-20");
    writeFileSync(mine, "");
    writeFileSync(join(root, "bin", "node"), "");
    expect(stableNode(mine, { PATH: join(root, "bin") }, "linux")).toBe(mine);
  });
});
