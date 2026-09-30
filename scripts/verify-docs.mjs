#!/usr/bin/env node

import { extname, join, relative, resolve } from "node:path";

import { documentationLinkFailures } from "./documentation-links.mjs";

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

  for (const path of markdownFiles) {
    failures.push(...documentationLinkFailures(root, path, markdownContents));
  }
  verifyPackageScripts(markdownFiles, markdownContents);
  verifyReleaseVersions();

  if (failures.length > 0) {
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Documentation verification passed for ${markdownFiles.length} Markdown files.`,
    );
  }
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
  for (const command of commands) {
    const { script } = command;
    if (allowedPnpmCommands.has(script)) continue;
    const manifest = manifestForCommand(
      command,
      rootManifest,
      manifestForDirectory,
    );
    if (hasPnpmScript(manifest, script)) continue;
    failures.push(missingPnpmScriptMessage(command));
  }
  return failures;
}

function manifestForCommand(command, rootManifest, manifestForDirectory) {
  return command.directory
    ? manifestForDirectory(command.directory)
    : rootManifest;
}

function hasPnpmScript(manifest, script) {
  return Boolean(manifest?.scripts && Object.hasOwn(manifest.scripts, script));
}

function missingPnpmScriptMessage({ directory, script }) {
  const directorySuffix = directory ? ` in ${directory}` : "";
  return `references missing package script ${script}${directorySuffix}`;
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
  const display = relative(root, path).replaceAll("\\", "/");
  if (
    /^(?:design-preview(?:\/|$)|output\/product-design-exploration-[^/]*(?:\/|$))/.test(
      display,
    )
  ) {
    return true;
  }
  return /(?:^|\/)(?:\.codacy|\.codegraph|\.git|\.local|\.next|\.repowise|\.serena|\.worktrees|coverage|dist|node_modules|release-artifacts|target)(?:\/|$)/.test(
    display,
  );
}

if (import.meta.main) verifyDocumentation();
