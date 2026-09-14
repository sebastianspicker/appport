#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".svg",
  ".txt",
]);
const forbidden = [
  [/@tauri-apps/i, "Tauri package reference"],
  [/__TAURI/i, "Tauri runtime reference"],
  [/APPPORT_RELUTION_/i, "Relution environment reference"],
  [/X-User-Access-Token/i, "Relution credential header"],
  [
    /\b(?:initial_view|list_apps|load_catalog|load_app_icon|request_action|get_action|sign_out|support_details|generate_support_bundle|open_support_folder|open_relution_portal)\b/,
    "native command name",
  ],
  [/type=["']password["']/i, "password field"],
  [/name=["'][^"']*(?:token|secret)[^"']*["']/i, "credential-named field"],
  [/\bfetch\s*\(/, "Fetch API call"],
  [/\b(?:XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/, "network API"],
  [
    /\b(?:localStorage|sessionStorage|serviceWorker|SharedWorker)\b/,
    "persistent browser API",
  ],
];

export function demoArtifactFailures(root) {
  const failures = [];
  const artifactRoot = join(root, "apps/web-demo/dist");
  if (!existsSync(artifactRoot)) {
    return ["apps/web-demo/dist is missing"];
  }
  const paths = walk(artifactRoot);
  verifyArtifactFiles(failures, root, paths);
  verifyIndex(failures, artifactRoot, paths);
  verifyProductionCsp(failures, root);
  return failures;
}

function walk(directory) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    paths.push(path);
    if (entry.isDirectory()) paths.push(...walk(path));
  }
  return paths;
}

function verifyArtifactFiles(failures, root, paths) {
  for (const path of paths) {
    const stats = lstatSync(path);
    const display = relative(root, path);
    if (stats.isSymbolicLink()) {
      failures.push(`${display} is a symbolic link`);
      continue;
    }
    if (!stats.isFile()) continue;
    if (extname(path) === ".map") failures.push(`${display} is a source map`);
    if (!textExtensions.has(extname(path))) continue;
    const contents = readFileSync(path, "utf8");
    for (const [pattern, label] of forbidden) {
      if (pattern.test(contents)) failures.push(`${display} contains ${label}`);
    }
  }
}

function verifyIndex(failures, artifactRoot, paths) {
  const indexPath = join(artifactRoot, "index.html");
  let index = "";
  try {
    index = readFileSync(indexPath, "utf8");
  } catch {
    failures.push("apps/web-demo/dist/index.html is missing");
  }
  if (!index.includes("connect-src 'none'")) {
    failures.push("demo CSP does not disable connections");
  }
  if (
    !index.includes('data-demo-build="appport-synthetic-demo"') &&
    !allText(paths).includes("appport-synthetic-demo")
  ) {
    failures.push("demo build marker is missing");
  }
  for (const match of index.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1];
    if (!value.startsWith("./") && !value.startsWith("#")) {
      failures.push(`index.html contains non-relative asset ${value}`);
    }
  }
}

function verifyProductionCsp(failures, root) {
  const configurationPath = join(
    root,
    "apps/windows-client/src-tauri/tauri.conf.json",
  );
  let configuration = "";
  try {
    configuration = readFileSync(configurationPath, "utf8");
  } catch {
    failures.push("production Tauri configuration is missing");
  }
  if (!configuration.includes("connect-src 'none'")) {
    failures.push("production Tauri CSP no longer disables connections");
  }
}

function allText(paths) {
  return paths
    .filter(
      (path) => lstatSync(path).isFile() && textExtensions.has(extname(path)),
    )
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

function run() {
  const root = resolve(import.meta.dirname, "..");
  const failures = demoArtifactFailures(root);
  if (failures.length) {
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("GitHub Pages demo artifact isolation verified.");
  }
}

if (import.meta.main) run();
