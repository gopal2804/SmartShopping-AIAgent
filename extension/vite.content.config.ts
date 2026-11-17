import { defineConfig } from "vite";

// Content scripts cannot load ES module chunks, so they are built separately as one self-contained IIFE.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/content/index.ts",
      name: "SmartShoppingContent",
      formats: ["iife"],
      fileName: () => "content.js",
    },
  },
});
