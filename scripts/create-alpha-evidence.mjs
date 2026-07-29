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
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const version = readJson(resolve(root, "package.json")).version;
const evidenceDirectory = resolve(root, `release-artifacts/${version}`);
const output = resolve(evidenceDirectory, "evidence.json");
const sourceEntries = [
  ".github",
  ".gitignore",
  ".node-version",
  ".prettierignore",
  ".prettierrc.json",
  "CONTRIBUTING.md",
  "README.md",
  "RELEASE_STATUS.md",
  "SECURITY.md",
  "apps/windows-client",
  "docs",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts",
];
const excludedDirectories = new Set([
  ".git",
  ".next",
  ".nyc_output",
  ".vite",
  "coverage",
  "dist",
  "gen",
  "node_modules",
  "release-artifacts",
  "target",
  "test-results",
]);
const forbiddenNames = [/^\.env/i, /\.(?:key|pem|p12|pfx)$/i];
const forbiddenBinaryMarkers = [
  "Appport/Bearer",
  "APPPORT_RELUTION_ACCESS_TOKEN",
  "APPPORT_CLIENT_SECRET",
  "RELUTION_API_TOKEN",
  "RELUTION_CLIENT_SECRET",
  "TECHNICAL_ACCOUNT",
  "BEGIN PRIVATE KEY",
  "BEGIN RSA PRIVATE KEY",
  "technical-account-token",
];
const gateCommands = [
  ["toolchain", "pnpm", ["verify:toolchain"]],
  ["format", "pnpm", ["format:check"]],
  ["documentation", "pnpm", ["docs:verify"]],
  ["client-types", "pnpm", ["client:typecheck"]],
  ["client-coverage", "pnpm", ["client:test:coverage"]],
  ["client-build", "pnpm", ["client:build"]],
  ["rust-format", "pnpm", ["client:rust:fmt"]],
  ["rust-clippy", "pnpm", ["client:rust:clippy"]],
  ["rust-tests", "pnpm", ["client:rust:test"]],
  ["rust-check", "pnpm", ["client:rust:check"]],
];

const gitCommit = commandOutput("git", ["rev-parse", "HEAD"]);
const gitStatus = commandRaw("git", [
  "status",
  "--porcelain=v1",
  "--untracked-files=all",
]);
const configuration = inspectConfiguration();
const gates = gateCommands.map(([name, executable, args]) =>
  runGate(name, executable, args),
);
const files = [];
for (const entry of sourceEntries) collect(resolve(root, entry));
files.sort((left, right) => left.path.localeCompare(right.path));
const tree = createHash("sha256");
for (const file of files) tree.update(`${file.sha256}  ${file.path}\n`);
const artifact = inspectArtifact(parseArtifact());
const sourceGatesPassed = gates.every((gate) => gate.exitStatus === 0);
const candidateReady = Boolean(
  sourceGatesPassed &&
    artifact &&
    artifact.formatValid &&
    configuration.valid &&
    artifact.embeddedSecretScanPassed &&
    artifact.signatureStatus === "not_signed",
);
const repository = {
  commit: gitCommit,
  state: gitStatus.length === 0 ? "clean" : "dirty",
  dirtyEntries: gitStatus.length === 0 ? [] : gitStatus.split("\n"),
};

mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
writeJson("source-revision-state.json", repository);
writeJson("configuration-fingerprint.json", {
  valid: configuration.valid,
  fingerprintSha256: configuration.fingerprintSha256,
  failures: configuration.failures,
  writesEnabled: false,
});
writeJson(
  "embedded-secret-scan.json",
  artifact
    ? {
        artifact: artifact.name,
        passed: artifact.embeddedSecretScanPassed,
        forbiddenMarkers: artifact.forbiddenMarkers,
      }
    : { artifact: null, passed: false, forbiddenMarkers: [] },
);
if (artifact)
  writeFileSync(
    resolve(evidenceDirectory, "msi-sha256.txt"),
    `${artifact.sha256}  ${artifact.name}\n`,
    { mode: 0o600 },
  );

writeFileSync(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 4,
      version,
      candidateReady,
      signed: artifact?.signed ?? false,
      distributable: false,
      sourceGatesPassed,
      repository,
      tools: {
        node: process.version,
        pnpm: commandOutput("pnpm", ["--version"]),
        rustc: commandOutput("rustc", ["--version"]),
        cargo: commandOutput("cargo", ["--version"]),
      },
      gates,
      sourceTreeSha256: tree.digest("hex"),
      sourceFileCount: files.length,
      sourceFiles: files,
      qualificationConfiguration: {
        valid: configuration.valid,
        fingerprintSha256: configuration.fingerprintSha256,
        failures: configuration.failures,
        writesEnabled: false,
      },
      windowsArtifact: artifact,
      externalGates: {
        managedTenantConnection: "external_unqualified",
        managedTenantCatalog: "external_unqualified",
        managedTenantIcons: "external_unqualified",
        managedTenantInventory: "external_unqualified",
        managedBackgroundCheck: "external_unqualified",
        destructiveAuthorization: "external_unqualified",
        signing: "external_unqualified",
        productionQualification: "external_unqualified",
      },
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
console.log(relative(root, output));
if (!sourceGatesPassed || (artifact && !candidateReady)) process.exitCode = 1;

function runGate(name, executable, args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    name,
    command: [executable, ...args].join(" "),
    exitStatus: result.status ?? 1,
    durationMs: Math.round(
      Number(process.hrtime.bigint() - started) / 1_000_000,
    ),
    outputSha256: hash(`${result.stdout ?? ""}${result.stderr ?? ""}`),
  };
}
function parseArtifact() {
  if (process.argv.length === 2) return null;
  if (process.argv.length !== 4 || process.argv[2] !== "--msi")
    throw new Error("Use --msi /absolute/path/to/Appport.msi.");
  const path = resolve(process.argv[3]);
  if (!path.toLowerCase().endsWith(".msi"))
    throw new Error("Release artifact must be an MSI file.");
  return path;
}
function inspectArtifact(path) {
  if (!path) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Release artifact must be a regular non-symlink file.");
  const contents = readFileSync(path);
  const msiMagic = Buffer.from([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
  ]);
  const forbiddenMarkers = forbiddenBinaryMarkers.filter((marker) =>
    [Buffer.from(marker, "utf8"), Buffer.from(marker, "utf16le")].some(
      (encoded) => contents.includes(encoded),
    ),
  );
  const signatureStatus =
    process.platform === "win32" ? authenticodeStatus(path) : "not_checked";
  return {
    name: path.split(sep).at(-1),
    bytes: stat.size,
    sha256: hash(contents),
    formatValid:
      contents.length >= msiMagic.length &&
      contents.subarray(0, msiMagic.length).equals(msiMagic),
    signatureStatus,
    signed: signatureStatus === "valid",
    forbiddenMarkers,
    embeddedSecretScanPassed: forbiddenMarkers.length === 0,
  };
}
function inspectConfiguration() {
  const origin = process.env.APPPORT_RELUTION_API_BASE_URL ?? "";
  const organization = process.env.APPPORT_RELUTION_ORGANIZATION_UUID ?? "";
  const nativeApp = process.env.APPPORT_NATIVE_APP_UUID ?? "";
  const writes = process.env.APPPORT_RELUTION_WRITES_ENABLED ?? "";
  const failures = [];
  if (!isQualificationOrigin(origin))
    failures.push("invalid qualification-tenant origin");
  if (!isQualificationUuid(organization))
    failures.push("invalid organization UUID");
  if (!isQualificationUuid(nativeApp))
    failures.push("invalid native application UUID");
  if (organization.toLowerCase() === nativeApp.toLowerCase())
    failures.push("organization and native application UUIDs must differ");
  if (writes !== "false") failures.push("writes must be exactly false");
  return {
    valid: failures.length === 0,
    failures,
    fingerprintSha256: hash(
      `origin=${origin}\norganization=${organization}\nnativeApplication=${nativeApp}\nwrites=${writes}\n`,
    ),
  };
}
function isQualificationOrigin(value) {
  if (!value || value.trim() !== value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return Boolean(
      url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === "" &&
        !["localhost", "example.com", "example.test"].some(
          (placeholder) =>
            host === placeholder || host.endsWith(`.${placeholder}`),
        ) &&
        !host.endsWith(".invalid"),
    );
  } catch {
    return false;
  }
}
function isQualificationUuid(value) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    return false;
  const compact = value.replaceAll("-", "").toLowerCase();
  return !/^0+$/.test(compact) && !/^(.)\1+$/.test(compact);
}
function authenticodeStatus(path) {
  const escaped = path.replaceAll("'", "''");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status.ToString().ToLowerInvariant()`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return "unknown";
  const status = result.stdout.trim().toLowerCase();
  return status === "notsigned" ? "not_signed" : status || "unknown";
}
function commandOutput(executable, args) {
  return commandRaw(executable, args).trim();
}
function commandRaw(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0)
    throw new Error(
      `${[executable, ...args].join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  return result.stdout.replace(/\n$/, "");
}
function collect(path) {
  const name = path.split(sep).at(-1);
  if (forbiddenNames.some((pattern) => pattern.test(name)))
    throw new Error(
      `Forbidden release-evidence input: ${relative(root, path)}`,
    );
  const stat = lstatSync(path);
  if (stat.isSymbolicLink())
    throw new Error(
      `Symlinks are not allowed in release evidence: ${relative(root, path)}`,
    );
  if (stat.isDirectory()) {
    if (excludedDirectories.has(name)) return;
    for (const child of readdirSync(path).sort()) collect(resolve(path, child));
  } else if (
    stat.isFile() &&
    ![".DS_Store"].includes(name) &&
    !name.endsWith(".tsbuildinfo") &&
    !name.endsWith(".log")
  ) {
    const contents = readFileSync(path);
    files.push({
      path: relative(root, path),
      bytes: contents.byteLength,
      sha256: hash(contents),
    });
  }
}
function writeJson(name, value) {
  writeFileSync(
    resolve(evidenceDirectory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
}
function hash(contents) {
  return createHash("sha256").update(contents).digest("hex");
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
