import { createHash } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import process from "node:process";

import { hash } from "./io.mjs";

const ignoredFileNames = new Set([".DS_Store"]);
const ignoredFileSuffixes = [".tsbuildinfo", ".log"];
const fs = process.getBuiltinModule("node:fs");

export function inspectSourceTree({
  root,
  sourceEntries,
  excludedDirectories,
  forbiddenNames,
}) {
  const files = [];
  for (const entry of sourceEntries) {
    collectSourceEntry(resolve(root, entry), {
      root,
      files,
      excludedDirectories,
      forbiddenNames,
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, sha256: sourceTreeHash(files) };
}

function collectSourceEntry(path, context) {
  const name = path.split(sep).at(-1);
  rejectForbiddenName(name, path, context);
  const stat = fs.lstatSync(path);
  rejectSymbolicLink(stat, path, context.root);
  if (stat.isDirectory()) return collectDirectory(path, name, context);
  if (shouldIgnoreFile(stat, name)) return;
  const contents = fs.readFileSync(path);
  context.files.push({
    path: relative(context.root, path),
    bytes: contents.byteLength,
    sha256: hash(contents),
  });
}

function rejectForbiddenName(name, path, context) {
  if (context.forbiddenNames.some((pattern) => pattern.test(name))) {
    throw new Error(
      `Forbidden release-evidence input: ${relative(context.root, path)}`,
    );
  }
}

function rejectSymbolicLink(stat, path, root) {
  if (stat.isSymbolicLink()) {
    throw new Error(
      `Symlinks are not allowed in release evidence: ${relative(root, path)}`,
    );
  }
}

function collectDirectory(path, name, context) {
  if (context.excludedDirectories.has(name)) return;
  for (const child of readDirectory(path)) {
    collectSourceEntry(resolve(path, child), context);
  }
}

function shouldIgnoreFile(stat, name) {
  return (
    !stat.isFile() ||
    ignoredFileNames.has(name) ||
    ignoredFileSuffixes.some((suffix) => name.endsWith(suffix))
  );
}

function sourceTreeHash(files) {
  const tree = createHash("sha256");
  for (const file of files) tree.update(`${file.sha256}  ${file.path}\n`);
  return tree.digest("hex");
}

function readDirectory(path) {
  const directory = fs.opendirSync(path);
  try {
    return Array.from(directory, (entry) => entry.name).sort();
  } finally {
    directory.closeSync();
  }
}
