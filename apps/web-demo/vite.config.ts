import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    modulePreload: { polyfill: false },
    outDir: "dist",
    sourcemap: false,
    target: ["es2022", "chrome105"],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/testing/setup.ts"],
  },
});
