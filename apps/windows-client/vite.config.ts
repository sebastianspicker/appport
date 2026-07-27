import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { strictPort: true, port: 1420, host: "127.0.0.1" },
  envPrefix: ["VITE_"],
  build: { target: ["es2022", "chrome105"] },
  test: { environment: "jsdom", globals: true },
});
