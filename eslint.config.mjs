import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/**",
    ".codacy/**",
    ".local/**",
    "coverage/**",
    "apps/windows-client/dist/**",
    "apps/windows-client/src-tauri/gen/**",
    "apps/windows-client/src-tauri/target/**",
  ]),
]);
