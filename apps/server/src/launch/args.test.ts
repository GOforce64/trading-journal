import { describe, expect, it } from "vitest";
import { launchArgs, parseLaunchArgs } from "./args.js";

describe("the launcher's arguments", () => {
  it("run main.ts through tsx with what setup recorded", () => {
    expect(launchArgs({ pnpm: "/home/u/.local/bin/pnpm", dataDir: null, port: null })).toEqual([
      "--import",
      "tsx",
      "src/launch/main.ts",
      "--pnpm",
      "/home/u/.local/bin/pnpm",
    ]);
  });

  it("read back what they wrote", () => {
    const args = { pnpm: "C:\\pnpm\\pnpm.exe", dataDir: "D:\\journal data", port: 4300 };
    expect(parseLaunchArgs(launchArgs(args).slice(3))).toEqual(args);
    expect(parseLaunchArgs(["--pnpm", "/p"])).toEqual({ pnpm: "/p", dataDir: null, port: null });
  });
});
