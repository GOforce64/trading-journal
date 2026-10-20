import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { launchArgs } from "./args.js";

/** What `pnpm launcher:install` records (launcher spec §3.1). */
export interface LauncherSetup {
  node: string;
  pnpm: string;
  repo: string;
  dataDir: string | null;
  port: number | null;
}

/**
 * One Exec argument, as the desktop entry spec asks: quoted, `"` `` ` `` `$` `\` escaped, then the string
 * escaping doubles each backslash, and `%` is written `%%`.
 */
export const execArg = (arg: string) =>
  `"${arg.replace(/[\\"`$]/g, (char) => (char === "\\" ? "\\\\\\\\" : `\\\\${char}`)).replace(/%/g, "%%")}"`;

/** The Fedora app-menu entry: `trading-journal.desktop`. */
export function desktopEntry(setup: LauncherSetup): string {
  const exec = [setup.node, ...launchArgs(setup)].map(execArg).join(" ");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Trading Journal",
    "Comment=Open your trading journal",
    `Exec=${exec}`,
    `Path=${posix.join(setup.repo, "apps", "server")}`,
    `Icon=${posix.join(setup.repo, "apps", "web", "public", "icon-256.png")}`,
    "Terminal=false",
    "Categories=Office;Finance;",
    "StartupNotify=false",
    "",
  ].join("\n");
}

/** A Windows command-line argument: quoted when it holds a space or a quote. */
export const winArg = (arg: string) =>
  /[\s"]/.test(arg) ? `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"` : arg;
const psString = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** The PowerShell that makes the Start-menu shortcut: minimized, so its console only flashes on the taskbar. */
export function shortcutScript(setup: LauncherSetup, lnk: string): string {
  return [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psString(lnk)})`,
    `$s.TargetPath = ${psString(setup.node)}`,
    `$s.Arguments = ${psString(launchArgs(setup).map(winArg).join(" "))}`,
    `$s.WorkingDirectory = ${psString(win32.join(setup.repo, "apps", "server"))}`,
    `$s.IconLocation = ${psString(win32.join(setup.repo, "apps", "web", "public", "icon.ico"))}`,
    "$s.WindowStyle = 7",
    "$s.Description = 'Open your trading journal'",
    "$s.Save()",
  ].join("\n");
}

export function launcherFile(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string | null {
  if (platform === "win32") {
    const roaming = env.APPDATA ?? win32.join(home, "AppData", "Roaming");
    return win32.join(roaming, "Microsoft", "Windows", "Start Menu", "Programs", "Trading Journal.lnk");
  }
  if (platform === "linux") {
    const data = env.XDG_DATA_HOME ?? posix.join(home, ".local", "share");
    return posix.join(data, "applications", "trading-journal.desktop");
  }
  return null;
}

/** A command's full path, as the terminal's PATH finds it. */
export function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const windows = platform === "win32";
  const dirs = (env.PATH ?? env.Path ?? "").split(windows ? ";" : ":").filter(Boolean);
  const extensions = windows ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = (windows ? win32 : posix).join(dir, `${name}${extension.toLowerCase()}`);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * The node the icon should run: the PATH's `node` when it's this same binary, else this one. Fedora's /usr/bin/node
 * links to /usr/bin/node-22, the path `process.execPath` gives, which an upgrade can remove (launcher spec §14).
 */
export function stableNode(execPath: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const onPath = findOnPath("node", env, platform);
  if (!onPath) return execPath;
  try {
    return realpathSync(onPath) === realpathSync(execPath) ? onPath : execPath;
  } catch {
    return execPath;
  }
}

const MAC = "The launcher icon is for Linux and Windows; on a Mac, run `pnpm start`.";

/** Writes the icon; returns where. */
export function installLauncher(
  setup: LauncherSetup,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string {
  const file = launcherFile(platform, env, home);
  if (!file) throw new Error(MAC);
  mkdirSync((platform === "win32" ? win32 : posix).dirname(file), { recursive: true });
  if (platform === "win32") {
    const made = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        shortcutScript(setup, file),
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (made.status !== 0) throw new Error(`PowerShell couldn't make the shortcut: ${made.stderr.trim()}`);
  } else {
    writeFileSync(file, desktopEntry(setup), { mode: 0o755 });
    // Optional: menus pick the entry up anyway, this only makes it quicker.
    spawnSync("update-desktop-database", [posix.dirname(file)], { stdio: "ignore" });
  }
  return file;
}

/** Deletes the icon; returns where it was, or null when there was none. */
export function removeLauncher(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string | null {
  const file = launcherFile(platform, env, home);
  if (!file || !existsSync(file)) return null;
  rmSync(file);
  return file;
}
