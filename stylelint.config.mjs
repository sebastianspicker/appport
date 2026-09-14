export default {
  extends: ["stylelint-config-standard"],
  ignoreFiles: [
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
  ],
};
