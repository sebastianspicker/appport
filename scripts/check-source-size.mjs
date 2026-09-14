#!/usr/bin/env node

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export const maximumPhysicalLines = 500;
export const sourceExtensions = new Set([".css", ".mjs", ".rs", ".ts", ".tsx"]);

const excludedDirectoryNames = new Set([
  ".git",
  ".local",
  ".worktrees",
  "archive",
  "coverage",
  "design-preview",
  "dist",
  "generated",
  "index",
  "node_modules",
  "release-artifacts",
  "target",
]);

const cohorts = Object.freeze({
  demo: { excludedPathPrefixes: [], roots: ["apps/web-demo"] },
  source: { excludedPathPrefixes: ["apps/web-demo/"], roots: ["."] },
});

export function physicalLineCount(contents) {
  if (!contents) return 0;
  const lines = contents.split(/\r\n|[\n\r]/);
  return /(?:\r\n|[\n\r])$/.test(contents) ? lines.length - 1 : lines.length;
}

export function isExcluded(relativePath) {
  return relativePath
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => excludedDirectoryNames.has(segment));
}

export function sourceFiles(root, roots, excludedPathPrefixes = []) {
  return roots.flatMap((directory) =>
    walk(resolve(root, directory), root, excludedPathPrefixes),
  );
}

export function checkSourceSizes(root, roots, excludedPathPrefixes = []) {
  return sourceFiles(root, roots, excludedPathPrefixes)
    .map((path) => ({
      lines: physicalLineCount(readFileSync(path, "utf8")),
      path: relative(root, path).replaceAll("\\", "/"),
    }))
    .filter((file) => file.lines > maximumPhysicalLines)
    .sort(
      (left, right) =>
        right.lines - left.lines || left.path.localeCompare(right.path),
    );
}

function walk(directory, root, excludedPathPrefixes) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const displayPath = relative(root, path).replaceAll("\\", "/");
    if (
      isExcluded(displayPath) ||
      excludedPathPrefixes.some((prefix) => displayPath.startsWith(prefix))
    )
      continue;
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory())
      files.push(...walk(path, root, excludedPathPrefixes));
    if (stats.isFile() && sourceExtensions.has(extension(entry.name)))
      files.push(path);
  }
  return files;
}

function extension(name) {
  return name.slice(name.lastIndexOf("."));
}

function selectedCohort(arguments_) {
  const cohortFlag = arguments_.indexOf("--cohort");
  const cohort = cohortFlag === -1 ? "source" : arguments_[cohortFlag + 1];
  if (!Object.hasOwn(cohorts, cohort)) {
    throw new Error(`Unknown source-size cohort: ${cohort ?? "missing"}`);
  }
  return cohort;
}

function run() {
  const cohort = selectedCohort(process.argv.slice(2));
  const root = resolve(import.meta.dirname, "..");
  const failures = checkSourceSizes(
    root,
    cohorts[cohort].roots,
    cohorts[cohort].excludedPathPrefixes,
  );
  if (failures.length === 0) {
    console.log(`Source-size check passed for ${cohort}.`);
    return;
  }

  console.error(
    failures
      .map(
        ({ lines, path }) =>
          `${path}: ${lines} physical lines exceeds ${maximumPhysicalLines}`,
      )
      .join("\n"),
  );
  process.exitCode = 1;
}

if (import.meta.main) run();
