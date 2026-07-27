#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const version = "0.1.0-alpha.1";
const output = resolve(
  root,
  `release-artifacts/${version}/evidence.json`,
);
const excludedDirectories = new Set([
  ".git",
  ".next",
  ".nyc_output",
  ".vite",
  "coverage",
  "dist",
  "gen",
  "node_modules",
  "playwright-report",
  "release-artifacts",
  "target",
  "test-results",
]);
const forbiddenNames = [/^\.env/i, /\.(?:key|pem|p12|pfx)$/i];
const excludedFiles = new Set([".DS_Store"]);
const sourceEntries = [
  ".dockerignore",
  ".gitignore",
  ".node-version",
  "Dockerfile",
  "CONTRIBUTING.md",
  "README.md",
  "RELEASE_STATUS.md",
  "SECURITY.md",
  "eslint.config.mjs",
  "next-env.d.ts",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "next.config.ts",
  "tsconfig.json",
  "vitest.config.ts",
  "apps/windows-client",
  "docs",
  "packages/appport-contracts",
  "scripts",
  "src",
];

const files = [];
for (const entry of sourceEntries) {
  collect(resolve(root, entry));
}
files.sort((left, right) => left.path.localeCompare(right.path));

const tree = createHash("sha256");
for (const file of files) {
  tree.update(`${file.sha256}  ${file.path}\n`);
}

const artifacts = [];
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] !== "--artifact" || index + 1 >= process.argv.length) {
    throw new Error("Artifacts must be supplied as --artifact /absolute/path.");
  }
  const artifactPath = resolve(process.argv[++index]);
  const stat = lstatSync(artifactPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Artifact must be a regular non-symlink file: ${artifactPath}`);
  }
  artifacts.push({
    name: artifactPath.split(sep).at(-1),
    bytes: stat.size,
    sha256: hash(readFileSync(artifactPath)),
  });
}

mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(
  output,
  `${JSON.stringify(
    {
      version,
      sourceTreeSha256: tree.digest("hex"),
      sourceFileCount: files.length,
      sourceFiles: files,
      artifacts,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
console.log(relative(root, output));

function collect(path) {
  const name = path.split(sep).at(-1);
  if (forbiddenNames.some((pattern) => pattern.test(name))) {
    throw new Error(`Forbidden release-evidence input: ${relative(root, path)}`);
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`Symlinks are not allowed in release evidence: ${relative(root, path)}`);
  }
  if (stat.isDirectory()) {
    if (excludedDirectories.has(name)) return;
    for (const child of readdirSync(path).sort()) {
      collect(resolve(path, child));
    }
    return;
  }
  if (!stat.isFile()) return;
  if (
    excludedFiles.has(name) ||
    name.endsWith(".tsbuildinfo") ||
    name.endsWith(".log") ||
    /\.sqlite(?:-.+)?$/.test(name)
  ) {
    return;
  }
  const contents = readFileSync(path);
  files.push({
    path: relative(root, path),
    bytes: contents.byteLength,
    sha256: hash(contents),
  });
}

function hash(contents) {
  return createHash("sha256").update(contents).digest("hex");
}
