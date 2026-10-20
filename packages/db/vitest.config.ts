import { defineConfig } from "vitest/config";

// Run from this package alone, the tests still get the run's own temp folder, as under the root config (missed
// spec §14), so its temp journals don't pile up either.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    globalSetup: ["../../scripts/vitest-tmp.ts"],
  },
});
