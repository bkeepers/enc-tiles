import { defineConfig } from "vitest/config";

// The generators in bin/ are standalone node scripts, not part of any
// workspace package, so they get their own vitest project rather than being
// smuggled into one of the packages/*.
export default defineConfig({
  test: {
    name: "bin",
    include: ["*.test.js"],
  },
});
