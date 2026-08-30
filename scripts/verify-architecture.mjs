#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const frontendRoot = "apps/windows-client/src";
const rustRoot = "apps/windows-client/src-tauri/src";
const requiredPaths = [
  "apps/windows-client/native-contract.json",
  "docs/ARCHITECTURE.md",
  `${frontendRoot}/app/App.tsx`,
  `${frontendRoot}/catalog/CatalogPage.tsx`,
  `${frontendRoot}/i18n/copy.ts`,
  `${frontendRoot}/native-bridge/native.ts`,
  `${frontendRoot}/native-bridge/types.ts`,
  `${frontendRoot}/session/SessionControls.tsx`,
  `${frontendRoot}/support/SupportPanel.tsx`,
  `${frontendRoot}/ui/Status.tsx`,
  `${rustRoot}/application/mod.rs`,
  `${rustRoot}/application/session.rs`,
  `${rustRoot}/domain/mod.rs`,
  `${rustRoot}/infrastructure/mod.rs`,
  `${rustRoot}/interface/mod.rs`,
  `${rustRoot}/interface/runtime.rs`,
  `${rustRoot}/interface/wire.rs`,
  `${rustRoot}/qualification/checks.rs`,
  `${rustRoot}/qualification/plan.rs`,
  `${rustRoot}/qualification/report.rs`,
];

const failures = architectureFailures();
if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Architecture verification passed.");
}

export function architectureFailures() {
  const failures = [];
  for (const path of requiredPaths) {
    if (!exists(path)) failures.push(`missing required module ${path}`);
  }
  verifyFrontendNativeImports(failures);
  verifyFrontendFeatureImports(failures);
  verifyWorkflowScripts(failures);
  verifyRustStructure(failures);
  return failures;
}

function verifyFrontendFeatureImports(failures) {
  const features = ["catalog", "session", "support"];
  for (const feature of features) {
    for (const path of sourceFiles(
      `${frontendRoot}/${feature}`,
      /\.(?:ts|tsx)$/,
    )) {
      if (path.includes(".test.")) continue;
      const relativePath = relative(root, path).replaceAll("\\", "/");
      for (const specifier of importSpecifiers(read(path))) {
        const otherFeature = features.find(
          (candidate) =>
            candidate !== feature && specifier.includes(`/${candidate}/`),
        );
        if (otherFeature) {
          failures.push(
            `${relativePath} imports ${specifier}; feature implementation modules must remain independent`,
          );
        }
      }
    }
  }
}

function verifyWorkflowScripts(failures) {
  const scripts = JSON.parse(read("package.json")).scripts ?? {};
  const workflow = read(".github/workflows/verify.yml");
  for (const match of workflow.matchAll(/\bpnpm\s+([a-z][\w:-]*)/g)) {
    const name = match[1];
    if (name === "install" || name === "exec") continue;
    if (!(name in scripts)) {
      failures.push(`workflow invokes missing package script ${name}`);
    }
  }
}

function verifyFrontendNativeImports(failures) {
  for (const path of sourceFiles(frontendRoot, /\.(?:ts|tsx)$/)) {
    const source = read(path);
    const relativePath = relative(root, path).replaceAll("\\", "/");
    if (/\baction_active\b|["']ACTION["']/.test(source)) {
      failures.push(
        `${relativePath} contains a native state not produced by the Rust contract`,
      );
    }
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith("@tauri-apps/api")) continue;
      if (
        specifier !== "@tauri-apps/api/core" ||
        !relativePath.startsWith(`${frontendRoot}/native-bridge/`)
      ) {
        failures.push(
          `${relativePath} imports ${specifier}; only native-bridge may import @tauri-apps/api/core`,
        );
      }
    }
  }
}

function verifyRustStructure(failures) {
  for (const path of sourceFiles(rustRoot, /\.rs$/)) {
    const source = read(path);
    const relativePath = relative(root, path).replaceAll("\\", "/");
    if (/^\s*use\s+[^;]*::\*\s*;/m.test(source)) {
      failures.push(`${relativePath} contains a glob import`);
    }
    if (relativePath.startsWith(`${rustRoot}/domain/`)) {
      if (
        /\b(?:tauri|reqwest|windows|rusqlite)::/.test(source) ||
        /\bcrate::(?:application|infrastructure|interface)\b/.test(source)
      ) {
        failures.push(`${relativePath} crosses the pure domain boundary`);
      }
    }
    if (relativePath.startsWith(`${rustRoot}/infrastructure/relution/`)) {
      if (
        /\bcrate::(?:application|interface)\b/.test(source) ||
        /\bcrate::infrastructure::(?:journal|windows)\b/.test(source)
      ) {
        failures.push(`${relativePath} crosses the Relution adapter boundary`);
      }
      if (
        /\bfn\s+(?:bootstrap|list_apps|request_action|get_action|icon)\s*\(/.test(
          source,
        )
      ) {
        failures.push(
          `${relativePath} contains an application workflow facade`,
        );
      }
    }
    if (
      relativePath === `${rustRoot}/interface/commands.rs` &&
      /Result<\s*support::Support(?:Details|BundleResult)/.test(source)
    ) {
      failures.push(
        `${relativePath} exposes an infrastructure support type at the native interface`,
      );
    }
  }
}

function importSpecifiers(source) {
  return source
    .split("\n")
    .map(
      (line) => /^\s*import(?:.+?\sfrom\s*)?["']([^"']+)["']/.exec(line)?.[1],
    )
    .filter(Boolean);
}

function sourceFiles(directory, extension) {
  const files = [];
  walk(resolve(root, directory), files);
  return files.filter((path) => extension.test(path));
}

function walk(directory, files) {
  for (const entry of readDirectory(directory)) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (entry.isFile()) files.push(path);
  }
}

function readDirectory(directory) {
  return existsSync(directory)
    ? process.getBuiltinModule("node:fs").readdirSync(directory, {
        withFileTypes: true,
      })
    : [];
}

function exists(path) {
  return existsSync(resolve(root, path));
}

function read(path) {
  return readFileSync(path, "utf8");
}
