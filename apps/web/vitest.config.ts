import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // A form test that types into many fields takes about 2 s alone and 2–3 times that under the whole suite's
    // parallel load, so the 5 s default made the slowest ones time out now and then.
    testTimeout: 15_000,
  },
});
