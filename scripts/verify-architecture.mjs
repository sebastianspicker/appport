#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import {
  demoPagesWorkflowFailures,
  verificationWorkflowFailures,
} from "./workflow-contracts.mjs";

const root = resolve(import.meta.dirname, "..");
const frontendRoot = "apps/windows-client/src";
const rustRoot = "apps/windows-client/src-tauri/src";
const requiredDirectories = [
  ...["app", "catalog", "session", "support", "native-bridge"].map(
    (layer) => `${frontendRoot}/${layer}`,
  ),
  ...[
    "interface",
    "application",
    "domain",
    "infrastructure",
    "qualification",
  ].map((layer) => `${rustRoot}/${layer}`),
];
const requiredFiles = [
  "apps/windows-client/native-contract.json",
  "apps/windows-client/wire-fixtures.json",
];

export function architectureFailures() {
  const failures = requiredLayoutFailures(pathKind);
  verifyFrontendNativeImports(failures);
  verifyFrontendFeatureImports(failures);
  verifyWorkflowScripts(failures);
  verifyRustStructure(failures);
  return failures;
}

export function requiredLayoutFailures(kindOf) {
  return [
    ...requiredDirectories
      .filter((path) => kindOf(path) !== "directory")
      .map((path) => `missing required layer directory ${path}`),
    ...requiredFiles
      .filter((path) => kindOf(path) !== "file")
      .map((path) => `missing required contract file ${path}`),
  ];
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
  failures.push(
    ...verificationWorkflowFailures(
      read(".github/workflows/verify.yml"),
      scripts,
    ),
    ...demoPagesWorkflowFailures(
      read(".github/workflows/demo-pages.yml"),
      scripts,
    ),
  );
}

function verifyFrontendNativeImports(failures) {
  for (const path of sourceFiles(frontendRoot, /\.(?:ts|tsx)$/)) {
    const source = read(path);
    const relativePath = relative(root, path).replaceAll("\\", "/");
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
    failures.push(...rustSourceFailures(relativePath, source));
  }
}

export function rustSourceFailures(relativePath, source) {
  const failures = [];
  const code = rustCode(source);
  const crate = rustPaths(code, "crate");
  const layers = new Set(crate.map(([layer]) => layer));
  verifyRustGlobImports(failures, relativePath, code);
  verifyPureDomainBoundary(failures, relativePath, code, layers);
  verifyInterfaceDependencies(failures, relativePath, layers);
  verifyRelutionDtoBoundary(failures, relativePath, code, crate);
  verifyInfrastructureBoundary(failures, relativePath, layers);
  verifyInterfaceBoundary(failures, relativePath, code, layers);
  verifyRelutionAdapterBoundary(failures, relativePath, code, crate);
  verifyTypedErrorClassification(failures, relativePath, source);
  return failures;
}

const impureDomainCrates = ["tauri", "reqwest", "windows", "rusqlite", "tokio"];
const impureDomainStd = [["fs"], ["net"], ["process"], ["time", "SystemTime"]];

function verifyRustGlobImports(failures, relativePath, code) {
  if (/\buse\s+[^;]*::\*/.test(code)) {
    failures.push(`${relativePath} contains a glob import`);
  }
}

function verifyPureDomainBoundary(failures, relativePath, code, layers) {
  if (!inRustLayer(relativePath, ["domain"])) return;
  const std = rustPaths(code, "std");
  if (
    ["application", "infrastructure", "interface"].some((layer) =>
      layers.has(layer),
    ) ||
    impureDomainCrates.some((name) => rustPaths(code, name).length > 0) ||
    impureDomainStd.some((prefix) =>
      std.some((path) =>
        prefix.every((segment, index) => path[index] === segment),
      ),
    )
  ) {
    failures.push(`${relativePath} crosses the pure domain boundary`);
  }
}

function verifyInterfaceDependencies(failures, relativePath, layers) {
  if (!inRustLayer(relativePath, ["application", "domain"])) return;
  if (layers.has("interface")) {
    failures.push(`${relativePath} depends on the outer interface layer`);
  }
}

function verifyRelutionDtoBoundary(failures, relativePath, code, crate) {
  if (!inRustLayer(relativePath, ["application", "qualification"])) return;
  if (
    /(?<![\w:])dto::/.test(code) ||
    crate.some((path) =>
      path.some(
        (segment, index) => segment === "relution" && path[index + 1] === "dto",
      ),
    )
  ) {
    failures.push(
      `${relativePath} references Relution DTOs; consume domain values from the adapter`,
    );
  }
}

function verifyInfrastructureBoundary(failures, relativePath, layers) {
  if (!inRustLayer(relativePath, ["infrastructure"])) return;
  if (layers.has("application") || layers.has("interface")) {
    failures.push(
      `${relativePath} depends on the application or interface layer`,
    );
  }
}

const adapterCrates = ["reqwest", "rusqlite", "windows", "winreg"];

function verifyInterfaceBoundary(failures, relativePath, code, layers) {
  if (!inRustLayer(relativePath, ["interface"])) return;
  if (
    layers.has("infrastructure") ||
    adapterCrates.some((name) => rustPaths(code, name).length > 0)
  ) {
    failures.push(
      `${relativePath} depends on infrastructure; call an application service`,
    );
  }
}

function inRustLayer(relativePath, layers) {
  return layers.some((layer) =>
    relativePath.startsWith(`${rustRoot}/${layer}/`),
  );
}

function verifyRelutionAdapterBoundary(failures, relativePath, code, crate) {
  if (!relativePath.startsWith(`${rustRoot}/infrastructure/relution/`)) return;
  if (
    crate.some(
      ([layer, adapter]) =>
        layer === "infrastructure" &&
        (adapter === "journal" || adapter === "windows"),
    )
  ) {
    failures.push(`${relativePath} crosses the Relution adapter boundary`);
  }
  if (
    /\bfn\s+(?:bootstrap|list_apps|request_action|get_action|icon)\s*\(/.test(
      code,
    )
  ) {
    failures.push(`${relativePath} contains an application workflow facade`);
  }
}

function verifyTypedErrorClassification(failures, relativePath, source) {
  if (/\.(?:starts_with|contains)\(\s*"[a-z_-]+:/.test(source)) {
    failures.push(
      `${relativePath} classifies errors by message text; match the typed error kind`,
    );
  }
}

/**
 * Returns every path rooted at `root` (for example `crate`) as its segments,
 * expanding grouped and nested `{ ... }` imports into one path per leaf.
 */
export function rustPaths(code, root) {
  const paths = [];
  const start = new RegExp(`(?<![\\w:$])${root}\\s*::`, "g");
  for (const match of code.matchAll(start)) {
    const tree = { code, index: match.index + match[0].length };
    paths.push(...useTree(tree));
  }
  return paths;
}

function useTree(tree) {
  skipWhitespace(tree);
  return tree.code[tree.index] === "{" ? useGroup(tree) : usePath(tree);
}

function useGroup(tree) {
  tree.index += 1;
  const paths = [];
  for (;;) {
    skipWhitespace(tree);
    const next = tree.code[tree.index];
    if (next === undefined) return paths;
    if (next === "}" || next === ",") {
      tree.index += 1;
      if (next === "}") return paths;
      continue;
    }
    const before = tree.index;
    paths.push(...useTree(tree));
    skipAlias(tree);
    if (tree.index === before) tree.index += 1;
  }
}

function usePath(tree) {
  const segment = /^(?:\w+|\*)/.exec(tree.code.slice(tree.index))?.[0];
  if (!segment) return [];
  tree.index += segment.length;
  const separator = /^\s*::/.exec(tree.code.slice(tree.index));
  if (!separator) return [[segment]];
  tree.index += separator[0].length;
  const rest = useTree(tree);
  return rest.length > 0 ? rest.map((path) => [segment, ...path]) : [[segment]];
}

function skipWhitespace(tree) {
  while (/\s/.test(tree.code[tree.index] ?? "")) tree.index += 1;
}

function skipAlias(tree) {
  const alias = /^\s+as\s+\w+/.exec(tree.code.slice(tree.index));
  if (alias) tree.index += alias[0].length;
}

const rustLiterals = [
  /\/\/[^\n]*/y,
  /\/\*[\s\S]*?\*\//y,
  /(?<!\w)b?r(#*)"[\s\S]*?"\1/y,
  /b?"(?:\\[\s\S]|[^"\\])*"/y,
  /b?'(?:\\(?:'|[^']{1,10})|[^'\\])'/y,
];

/** Removes comments and replaces string and character literals with `""`. */
export function rustCode(source) {
  let code = "";
  let index = 0;
  while (index < source.length) {
    const literal = rustLiterals
      .map((pattern) => {
        pattern.lastIndex = index;
        return pattern.exec(source)?.[0];
      })
      .find(Boolean);
    if (literal) {
      code += literal.startsWith("/") ? " " : '""';
      index += literal.length;
    } else {
      code += source[index];
      index += 1;
    }
  }
  return code;
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

function pathKind(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return undefined;
  return statSync(absolute).isDirectory() ? "directory" : "file";
}

function read(path) {
  return readFileSync(path, "utf8");
}

function run() {
  const failures = architectureFailures();
  if (failures.length > 0) {
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Architecture verification passed.");
  }
}

if (import.meta.main) run();
