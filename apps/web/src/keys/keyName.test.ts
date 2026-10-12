import { describe, expect, it } from "vitest";
import { keyName } from "./keyName.js";

describe("keyName", () => {
  it.each([
    [{ key: "j", code: "KeyJ" }, "j"],
    [{ key: "J", code: "KeyJ" }, "j"],
    [{ key: "ξ", code: "KeyJ" }, "j"],
    [{ key: "1", code: "Digit1" }, "1"],
    [{ key: "1", code: "Numpad1" }, "1"],
    [{ key: "?", code: "Slash" }, "?"],
    [{ key: "Enter", code: "Enter" }, "Enter"],
    [{ key: "Escape", code: "Escape" }, "Escape"],
    [{ key: "!", code: "Digit1" }, null],
    [{ key: "ArrowDown", code: "ArrowDown" }, null],
  ])("%o → %s", (event, name) => {
    expect(keyName(event)).toBe(name);
  });
});
