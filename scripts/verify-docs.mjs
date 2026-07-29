#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
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
  const contents = readFileSync(path, "utf8");
  for (const match of contents.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (
      !rawTarget ||
      /^(?:https?:|mailto:|data:)/i.test(rawTarget) ||
      rawTarget.startsWith("/")
    )
      continue;
    const [rawFile, rawAnchor] = rawTarget.split("#", 2);
    const target = rawFile
      ? resolve(dirname(path), decodeURIComponent(rawFile))
      : path;
    if (!existsSync(target)) {
      failures.push(
        `${relative(root, path)} links to missing ${rawFile || rawTarget}`,
      );
      continue;
    }
    if (
      rawAnchor &&
      extname(target) === ".md" &&
      !markdownAnchors(readFileSync(target, "utf8")).has(
        decodeURIComponent(rawAnchor).toLowerCase(),
      )
    ) {
      failures.push(
        `${relative(root, path)} links to missing anchor #${rawAnchor} in ${relative(root, target)}`,
      );
    }
  }
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
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

function verifyPackageScripts() {
  const manifests = [
    readJson(join(root, "package.json")),
    readJson(join(root, "apps/windows-client/package.json")),
  ];
  for (const path of markdownFiles) {
    const contents = readFileSync(path, "utf8");
    for (const match of contents.matchAll(
      /`pnpm(?:\s+run)?\s+([\w:-]+)(?:\s[^`]*)?`/g,
    )) {
      const script = match[1];
      if (["install", "exec", "--dir", "dlx", "add"].includes(script)) continue;
      if (!manifests.some((manifest) => manifest.scripts?.[script])) {
        failures.push(
          `${relative(root, path)} references missing package script ${script}`,
        );
      }
    }
  }
}

function verifyReleaseVersions() {
  const expected = readJson(join(root, "package.json")).version;
  const tauri = readJson(
    join(root, "apps/windows-client/src-tauri/tauri.conf.json"),
  );
  const cargoLock = readFileSync(
    join(root, "apps/windows-client/src-tauri/Cargo.lock"),
    "utf8",
  );
  for (const [file, version] of [
    [
      "apps/windows-client/package.json",
      readJson(join(root, "apps/windows-client/package.json")).version,
    ],
    ["apps/windows-client/src-tauri/tauri.conf.json", tauri.version],
    [
      "apps/windows-client/src-tauri/Cargo.toml",
      /^version\s*=\s*"([^"]+)"/m.exec(
        readFileSync(
          join(root, "apps/windows-client/src-tauri/Cargo.toml"),
          "utf8",
        ),
      )?.[1],
    ],
    [
      "apps/windows-client/src-tauri/Cargo.lock",
      /name\s*=\s*"relution-appport"\s*\nversion\s*=\s*"([^"]+)"/m.exec(
        cargoLock,
      )?.[1],
    ],
  ]) {
    if (version !== expected)
      failures.push(
        `${file} version ${version ?? "missing"} differs from ${expected}`,
      );
  }
  const expectedWix = expected.replace("-alpha.", ".");
  if (tauri.bundle?.windows?.wix?.version !== expectedWix) {
    failures.push(
      `apps/windows-client/src-tauri/tauri.conf.json WiX version ${tauri.bundle?.windows?.wix?.version ?? "missing"} differs from ${expectedWix}`,
    );
  }
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
    if (existsSync(join(root, path)))
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
    const contents = readFileSync(path, "utf8");
    if (/\b(?:broker|container)\b/i.test(contents)) {
      failures.push(
        `${relativePath} contains terminology outside the standalone product boundary`,
      );
    }
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const paths = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (isExcluded(path)) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) paths.push(...walk(path));
    else if (stat.isFile()) paths.push(path);
  }
  return paths;
}

function isExcluded(path) {
  return /(?:^|\/)(?:\.codacy|\.codegraph|\.git|\.local|\.next|\.serena|coverage|dist|node_modules|release-artifacts|target)(?:\/|$)/.test(
    relative(root, path).replaceAll("\\", "/"),
  );
}
