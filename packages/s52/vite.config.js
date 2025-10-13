// vite.config.js
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"), // Your library's entry point
      fileName: "index", // Naming convention for output files
      formats: ["es"], // Desired output formats
    },
    rollupOptions: {},
  },
});
