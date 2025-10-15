// vite.config.js
import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { mkdir, writeFile } from "fs/promises";
import buildColours from "./src/build/colours.js";
import buildSymbols from "./src/build/symbols.js";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"), // Your library's entry point
      fileName: "index", // Naming convention for output files
      formats: ["es"], // Desired output formats
    },
  },
  plugins: [buildColours(), buildSymbols()],
});
