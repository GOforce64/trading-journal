import { describe, expect, it } from "vitest";
import { uuidV5 } from "./ids.js";

describe("uuidV5", () => {
  it("matches the RFC 4122 reference value", () => {
    // Python: uuid.uuid5(uuid.NAMESPACE_DNS, "python.org")
    expect(uuidV5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "886313e1-3b8a-5372-9b90-0c9aee199e5d",
    );
  });

  it("is stable for the same name and differs for another", () => {
    const ns = "b92b0110-2258-4151-8c35-73de08de03ca";
    expect(uuidV5("a", ns)).toBe(uuidV5("a", ns));
    expect(uuidV5("a", ns)).not.toBe(uuidV5("b", ns));
  });
});
