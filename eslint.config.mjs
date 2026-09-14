import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const ignoredPaths = [
  "**/.git/**",
  "**/.local/**",
  "**/.worktrees/**",
  "**/archive/**",
  "**/design-preview/**",
  "**/dist/**",
  "**/generated/**",
  "**/index/**",
  "**/node_modules/**",
  "**/target/**",
];

export default tseslint.config(
  { ignores: ignoredPaths },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      complexity: ["error", 10],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
    },
  },
);
