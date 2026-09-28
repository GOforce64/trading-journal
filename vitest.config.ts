import { defineConfig } from "vitest/config";

// Each workspace package supplies its own config when it needs one (the web app
// needs jsdom); everything else runs with the defaults.
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    // `tsc -b` emits compiled copies of the tests; only the sources should run.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
