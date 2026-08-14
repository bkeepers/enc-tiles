import { defineConfig } from "vitest/config";

// Each workspace runs its own vitest suite; this config covers only the
// repo-level tests for the build scripts under bin/.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
