// vite.config.js
import { defineConfig } from "vite";
import { resolve } from "path";
import buildData from "./build/data.js";
import buildColours from "./build/colours.js";
import buildSymbols from "./build/symbols.js";
import buildSprites from "./build/sprites.js";
import buildSpritecss from "./build/spritecss.js";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"), // Your library's entry point
      fileName: "index", // Naming convention for output files
      formats: ["es"], // Desired output formats
    },
  },
  plugins: [
    buildData,
    buildColours,
    buildSymbols,
    buildSprites,
    buildSpritecss,
  ],
});
