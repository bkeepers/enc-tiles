import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // "test" holds the fixture runs of the standalone generators in bin/,
    // which belong to no workspace package.
    projects: ["packages/*", "test"],
  },
});
