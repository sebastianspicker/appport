#!/usr/bin/env node

import { dirname, extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fileSystem = process.getBuiltinModule("node:fs");
const failures = [];
const markdownFiles = walk(root).filter(
  (path) => extname(path) === ".md" && !isExcluded(path),
);

for (const path of markdownFiles) verifyLinks(path);
verifyPackageScripts();
verifyReleaseVersions();
verifyStandaloneBoundary();
verifyStandaloneLanguage();

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Documentation verification passed for ${markdownFiles.length} Markdown files.`,
  );
}

function verifyLinks(path) {
  const contents = readText(path);
  for (const match of contents.matchAll(/!?\[[^\]\r\n]*\]\(([^()\r\n]*)\)/g)) {
    const [, rawTargetMatch] = match;
    verifyLink(path, rawTargetMatch.trim().replace(/^<|>$/g, ""));
  }
}

function verifyLink(path, rawTarget) {
  if (isExternalTarget(rawTarget)) return;
  const { rawFile, rawAnchor, target } = resolveTarget(path, rawTarget);
  if (!isWithinRoot(target)) {
    failures.push(`${relative(root, path)} links outside the repository`);
    return;
  }
  if (!exists(target)) {
    failures.push(
      `${relative(root, path)} links to missing ${rawFile || rawTarget}`,
    );
    return;
  }
  verifyAnchor(path, target, rawAnchor);
}

function isExternalTarget(rawTarget) {
  return (
    !rawTarget ||
    /^(?:https?:|mailto:|data:)/i.test(rawTarget) ||
    rawTarget.startsWith("/")
  );
}

function resolveTarget(path, rawTarget) {
  const [rawFile, rawAnchor] = rawTarget.split("#", 2);
  return {
    rawFile,
    rawAnchor,
    target: rawFile
      ? resolve(dirname(path), decodeURIComponent(rawFile))
      : path,
  };
}

function verifyAnchor(path, target, rawAnchor) {
  if (!rawAnchor || extname(target) !== ".md") return;
  const anchors = markdownAnchors(readText(target));
  if (anchors.has(decodeURIComponent(rawAnchor).toLowerCase())) return;
  failures.push(
    `${relative(root, path)} links to missing anchor #${rawAnchor} in ${relative(root, target)}`,
  );
}

function verifyPackageScripts() {
  const manifests = [
    readJson(join(root, "package.json")),
    readJson(join(root, "apps/windows-client/package.json")),
  ];
  for (const path of markdownFiles) {
    for (const script of documentedPnpmScripts(readText(path))) {
      if (["install", "exec", "--dir", "dlx", "add"].includes(script)) continue;
      if (
        !manifests.some(
          ({ scripts }) => scripts && Object.hasOwn(scripts, script),
        )
      ) {
        failures.push(
          `${relative(root, path)} references missing package script ${script}`,
        );
      }
    }
  }
}

function documentedPnpmScripts(contents) {
  const scripts = [];
  for (const command of contents.split("`")) {
    const [executable, firstArgument, secondArgument] = command
      .trim()
      .split(/\s+/);
    if (executable !== "pnpm") continue;
    const script = firstArgument === "run" ? secondArgument : firstArgument;
    if (script) scripts.push(script);
  }
  return scripts;
}

function verifyReleaseVersions() {
  const expected = readJson(join(root, "package.json")).version;
  const tauri = readJson(
    join(root, "apps/windows-client/src-tauri/tauri.conf.json"),
  );
  const cargoLock = readText(
    join(root, "apps/windows-client/src-tauri/Cargo.lock"),
  );
  for (const [file, version] of [
    [
      "apps/windows-client/package.json",
      readJson(join(root, "apps/windows-client/package.json")).version,
    ],
    ["apps/windows-client/src-tauri/tauri.conf.json", tauri.version],
    [
      "apps/windows-client/src-tauri/Cargo.toml",
      firstCapture(
        /^version\s*=\s*"([^"]+)"/m,
        readText(join(root, "apps/windows-client/src-tauri/Cargo.toml")),
      ),
    ],
    [
      "apps/windows-client/src-tauri/Cargo.lock",
      firstCapture(
        /name\s*=\s*"relution-appport"\s*\nversion\s*=\s*"([^"]+)"/m,
        cargoLock,
      ),
    ],
  ]) {
    if (version !== expected)
      failures.push(
        `${file} version ${version === undefined ? "missing" : version} differs from ${expected}`,
      );
  }
  const expectedWix = expected.replace("-alpha.", ".");
  const bundle = tauri.bundle || {};
  const windows = bundle.windows || {};
  const wix = windows.wix || {};
  if (wix.version !== expectedWix) {
    failures.push(
      `apps/windows-client/src-tauri/tauri.conf.json WiX version ${wix.version === undefined ? "missing" : wix.version} differs from ${expectedWix}`,
    );
  }
}

function firstCapture(pattern, contents) {
  const match = pattern.exec(contents);
  if (!match) return undefined;
  const [, capture] = match;
  return capture;
}

function verifyStandaloneBoundary() {
  for (const path of [
    "Dockerfile",
    ".dockerignore",
    "next.config.ts",
    "next-env.d.ts",
    "tsconfig.json",
    "vitest.config.ts",
    "eslint.config.mjs",
    "docs/HTTP_API.md",
  ]) {
    if (exists(join(root, path)))
      failures.push(`standalone repository must not contain ${path}`);
  }
}

function verifyStandaloneLanguage() {
  for (const path of markdownFiles) {
    const relativePath = relative(root, path).replaceAll("\\", "/");
    if (
      relativePath.startsWith("docs/releases/") ||
      relativePath.startsWith(".local/archive/")
    )
      continue;
    if (/\b(?:broker|container)\b/i.test(readText(path))) {
      failures.push(
        `${relativePath} contains terminology outside the standalone product boundary`,
      );
    }
  }
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function walk(directory) {
  if (!exists(directory)) return [];
  const paths = [];
  for (const entry of fileSystem.readdirSync(directory, {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    if (isExcluded(path)) continue;
    if (entry.isDirectory()) paths.push(...walk(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

function exists(path) {
  try {
    fileSystem.accessSync(path);
    return true;
  } catch {
    return false;
  }
}

function readText(path) {
  if (!isWithinRoot(path)) throw new Error(`Path outside repository: ${path}`);
  return fileSystem.readFileSync(path, "utf8");
}

function isWithinRoot(path) {
  const pathFromRoot = relative(root, resolve(path));
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !pathFromRoot.includes("../"))
  );
}

function isExcluded(path) {
  return /(?:^|\/)(?:\.codacy|\.codegraph|\.git|\.local|\.next|\.serena|coverage|dist|node_modules|release-artifacts|target)(?:\/|$)/.test(
    relative(root, path).replaceAll("\\", "/"),
  );
}

function markdownAnchors(contents) {
  const anchors = new Set();
  const counts = new Map();
  for (const line of contents.split("\n")) {
    const match = /^(?:#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (!match) continue;
    const base = match[1]
      .toLowerCase()
      .replace(/[`*_~]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    const storedCount = counts.get(base);
    const count = storedCount === undefined ? 0 : storedCount;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}
