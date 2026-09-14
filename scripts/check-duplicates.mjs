#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const cohorts = Object.freeze({
  demo: ["apps/web-demo"],
  source: [
    "eslint.config.mjs",
    "stylelint.config.mjs",
    "apps/windows-client",
    "scripts",
  ],
});

const cohortFlag = process.argv.indexOf("--cohort");
const cohort = cohortFlag === -1 ? "source" : process.argv[cohortFlag + 1];
if (!Object.hasOwn(cohorts, cohort)) {
  throw new Error(`Unknown duplication cohort: ${cohort ?? "missing"}`);
}

const root = resolve(import.meta.dirname, "..");
const result = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  [
    "exec",
    "jscpd",
    "--config",
    `jscpd.${cohort}.json`,
    "--no-colors",
    ...cohorts[cohort],
  ],
  {
    cwd: root,
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
