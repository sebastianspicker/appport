#!/usr/bin/env node

import { dirname, extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fileSystem = process.getBuiltinModule("node:fs");
const failures = [];
const allowedPnpmCommands = new Set(["install", "exec", "dlx", "add"]);

function verifyDocumentation() {
  const markdownFiles = walk(root).filter(
    (path) => extname(path) === ".md" && !isExcluded(path),
  );
  const markdownContents = new Map(
    markdownFiles.map((path) => [path, readText(path)]),
  );

  for (const path of markdownFiles) verifyLinks(path, markdownContents);
  verifyPackageScripts(markdownFiles, markdownContents);
  verifyReleaseVersions();
  verifyStandaloneBoundary();
  verifyStandaloneLanguage(markdownFiles, markdownContents);

  if (failures.length > 0) {
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Documentation verification passed for ${markdownFiles.length} Markdown files.`,
    );
  }
}

function verifyLinks(path, markdownContents) {
  const contents = markdownContents.get(path);
  for (const match of contents.matchAll(/!?\[[^\]\r\n]*\]\(([^()\r\n]*)\)/g)) {
    const [, rawTargetMatch] = match;
    verifyLink(
      path,
      rawTargetMatch.trim().replace(/^<|>$/g, ""),
      markdownContents,
    );
  }
}

function verifyLink(path, rawTarget, markdownContents) {
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
  verifyAnchor(path, target, rawAnchor, markdownContents);
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

function verifyAnchor(path, target, rawAnchor, markdownContents) {
  if (!rawAnchor || extname(target) !== ".md") return;
  const anchors = markdownAnchors(
    cachedMarkdownContents(target, markdownContents),
  );
  if (anchors.has(decodeURIComponent(rawAnchor).toLowerCase())) return;
  failures.push(
    `${relative(root, path)} links to missing anchor #${rawAnchor} in ${relative(root, target)}`,
  );
}

function verifyPackageScripts(markdownFiles, markdownContents) {
  const rootManifest = readJson(join(root, "package.json"));
  const manifests = new Map();
  for (const path of markdownFiles) {
    const commands = documentedPnpmScripts(markdownContents.get(path));
    for (const failure of missingPnpmScripts(
      commands,
      rootManifest,
      (directory) => packageManifest(directory, manifests),
    )) {
      failures.push(`${relative(root, path)} ${failure}`);
    }
  }
}

export function documentedPnpmScripts(contents) {
  const commands = [];
  for (const command of contents.split("`")) {
    const [executable, ...arguments_] = command.trim().split(/\s+/);
    if (executable !== "pnpm") continue;
    const { directory, script } = pnpmScript(arguments_);
    if (script) commands.push({ directory, script });
  }
  return commands;
}

export function missingPnpmScripts(
  commands,
  rootManifest,
  manifestForDirectory,
) {
  const failures = [];
  for (const { directory, script } of commands) {
    if (allowedPnpmCommands.has(script)) continue;
    const manifest = directory ? manifestForDirectory(directory) : rootManifest;
    if (!manifest?.scripts || !Object.hasOwn(manifest.scripts, script)) {
      failures.push(
        `references missing package script ${script}${directory ? ` in ${directory}` : ""}`,
      );
    }
  }
  return failures;
}

function pnpmScript(arguments_) {
  const [firstArgument, secondArgument, thirdArgument, fourthArgument] =
    arguments_;
  if (firstArgument === "--dir") {
    return {
      directory: secondArgument,
      script: thirdArgument === "run" ? fourthArgument : thirdArgument,
    };
  }
  return {
    directory: undefined,
    script: firstArgument === "run" ? secondArgument : firstArgument,
  };
}

function packageManifest(directory, manifests) {
  if (manifests.has(directory)) return manifests.get(directory);
  const manifestPath = resolve(root, directory, "package.json");
  const manifest =
    isWithinRoot(manifestPath) && exists(manifestPath)
      ? readJson(manifestPath)
      : undefined;
  manifests.set(directory, manifest);
  return manifest;
}

function verifyReleaseVersions() {
  const expected = readJson(join(root, "package.json")).version;
  const tauri = readJson(
    join(root, "apps/windows-client/src-tauri/tauri.conf.json"),
  );
  const cargoLock = readText(
    join(root, "apps/windows-client/src-tauri/Cargo.lock"),
  );
  verifyReleaseVersionSources(expected, tauri, cargoLock);
  verifyWixVersion(expected, tauri);
}

function verifyReleaseVersionSources(expected, tauri, cargoLock) {
  for (const [file, version] of releaseVersionSources(tauri, cargoLock)) {
    if (version !== expected) {
      failures.push(versionMismatch(file, version, expected));
    }
  }
}

function releaseVersionSources(tauri, cargoLock) {
  return [
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
  ];
}

function versionMismatch(file, version, expected) {
  return `${file} version ${version === undefined ? "missing" : version} differs from ${expected}`;
}

function verifyWixVersion(expected, tauri) {
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

export const forbiddenStandalonePaths = [
  "Dockerfile",
  ".dockerignore",
  "next.config.ts",
  "next-env.d.ts",
  "tsconfig.json",
  "vitest.config.ts",
  "eslint.config.mjs",
  "docs/HTTP_API.md",
  "src/app",
  "src/server",
  "packages/appport-contracts",
  "scripts/revoke-native-sessions.mjs",
];

export function standaloneBoundaryFailures(pathExists) {
  return forbiddenStandalonePaths
    .filter((path) => pathExists(path))
    .map((path) => `standalone repository must not contain ${path}`);
}

function verifyStandaloneBoundary() {
  failures.push(
    ...standaloneBoundaryFailures((path) => exists(join(root, path))),
  );
}

function verifyStandaloneLanguage(markdownFiles, markdownContents) {
  for (const path of markdownFiles) {
    const relativePath = relative(root, path).replaceAll("\\", "/");
    if (
      relativePath.startsWith("docs/releases/") ||
      relativePath.startsWith(".local/archive/")
    )
      continue;
    if (/\b(?:broker|container)\b/i.test(markdownContents.get(path))) {
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

function cachedMarkdownContents(path, markdownContents) {
  if (!markdownContents.has(path)) markdownContents.set(path, readText(path));
  return markdownContents.get(path);
}

function isWithinRoot(path) {
  const pathFromRoot = relative(root, resolve(path));
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !pathFromRoot.includes("../"))
  );
}

function isExcluded(path) {
  return /(?:^|\/)(?:\.codacy|\.codegraph|\.git|\.local|\.next|\.repowise|\.serena|\.worktrees|coverage|dist|node_modules|release-artifacts|target)(?:\/|$)/.test(
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

if (import.meta.main) verifyDocumentation();
