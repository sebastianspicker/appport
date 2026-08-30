#!/usr/bin/env node

import { relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  inspectMsiArtifact,
  inspectQualificationUtility,
} from "./alpha-evidence/artifacts.mjs";
import {
  commandOutput,
  commandRaw,
  runGateCommands,
} from "./alpha-evidence/commands.mjs";
import {
  configurationFailures,
  inspectConfiguration,
} from "./alpha-evidence/configuration.mjs";
import { readJson } from "./alpha-evidence/io.mjs";
import {
  inspectCleanupReport,
  inspectReport,
  notRun,
} from "./alpha-evidence/reports.mjs";
import { sourceGateCommands, sourceGateNames } from "./source-gates.mjs";
import { inspectSourceTree } from "./alpha-evidence/source-tree.mjs";

export {
  configurationFailures,
  inspectCleanupReport,
  inspectConfiguration,
  inspectReport,
};

const root = resolve(import.meta.dirname, "..");
const fs = process.getBuiltinModule("node:fs");
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
const inputOptions = new Map([
  ["--msi", "msi"],
  ["--windows-self-check", "windowsSelfCheck"],
  ["--live-report", "liveReport"],
  ["--cleanup-report", "cleanupReport"],
  ["--qualification-utility", "qualificationUtility"],
]);

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}

function main() {
  const inputs = parseArguments(process.argv.slice(2));
  const configuration = inspectConfiguration();
  const gates = runGateCommands(root, sourceGateCommands);
  const sourceTree = inspectSourceTree({
    root,
    sourceEntries,
    excludedDirectories,
    forbiddenNames,
  });
  const artifact = inspectMsiArtifact(inputs.msi, forbiddenBinaryMarkers);
  const qualificationUtility = inspectQualificationUtility(
    inputs.qualificationUtility,
    forbiddenBinaryMarkers,
  );
  const repository = inspectRepository();
  const candidateBinding = createCandidateBinding(
    artifact,
    qualificationUtility,
    configuration,
    repository,
  );
  const qualifications = inspectQualifications(
    inputs,
    configuration,
    candidateBinding,
  );
  const sourceGatesPassed = gates.every((gate) => gate.exitStatus === 0);
  const candidateReady = isCandidateReady({
    sourceGatesPassed,
    repository,
    artifact,
    qualificationUtility,
    configuration,
    windowsRuntime: qualifications.windowsRuntime,
  });
  const pilotQualified = isPilotQualified(
    candidateReady,
    configuration,
    qualifications,
  );
  ensureDirectory(evidenceDirectory);
  writeSupplementalEvidence(repository, configuration, artifact);
  writeJson(
    "evidence.json",
    createEvidence({
      configuration,
      sourceGatesPassed,
      repository,
      artifact,
      qualificationUtility,
      qualifications,
      gates,
      sourceTree,
      candidateReady,
      pilotQualified,
    }),
  );
  console.log(relative(root, output));
  setExitStatus(inputs, sourceGatesPassed, candidateReady, pilotQualified);
}

export function parseArguments(arguments_) {
  const inputs = emptyInputs();
  for (let index = 0; index < arguments_.length; index += 2) {
    setInputPath(inputs, arguments_[index], arguments_[index + 1]);
  }
  if (arguments_.length % 2 !== 0)
    throw new Error("Every option requires a path.");
  assertInputDependencies(inputs);
  return inputs;
}

function emptyInputs() {
  return {
    msi: null,
    windowsSelfCheck: null,
    liveReport: null,
    cleanupReport: null,
    qualificationUtility: null,
  };
}

function setInputPath(inputs, option, value) {
  const property = inputOptions.get(option);
  if (!property || !value || inputs[property]) {
    throw new Error(
      "Use each option at most once: --msi, --qualification-utility, --windows-self-check, --live-report, --cleanup-report.",
    );
  }
  inputs[property] = resolve(value);
}

function assertInputDependencies(inputs) {
  if (inputs.msi && !inputs.windowsSelfCheck) {
    throw new Error("MSI evidence requires --windows-self-check.");
  }
  if (inputs.msi && !inputs.qualificationUtility) {
    throw new Error("MSI evidence requires --qualification-utility.");
  }
  if (inputs.cleanupReport && !inputs.liveReport) {
    throw new Error("Cleanup evidence requires --live-report.");
  }
}

function inspectRepository() {
  const gitStatus = commandRaw(root, "git", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  return {
    commit: commandOutput(root, "git", ["rev-parse", "HEAD"]),
    state: gitStatus.length === 0 ? "clean" : "dirty",
    dirtyEntries: gitStatus.length === 0 ? [] : gitStatus.split("\n"),
  };
}

function createCandidateBinding(
  artifact,
  qualificationUtility,
  configuration,
  repository,
) {
  return {
    candidateMsiSha256: artifact?.sha256 ?? null,
    qualificationUtilitySha256: qualificationUtility?.sha256 ?? null,
    configurationFingerprintSha256: configuration.fingerprintSha256,
    sourceRevision: repository.commit,
  };
}

function inspectQualifications(inputs, configuration, candidateBinding) {
  const windowsRuntime = inspectReport(
    inputs.windowsSelfCheck,
    "windows_runtime",
    configuration.profile,
    configuration.writesEnabled,
    candidateBinding,
  );
  const liveQualification = inspectReport(
    inputs.liveReport,
    "live_qualification",
    configuration.profile,
    configuration.writesEnabled,
    candidateBinding,
  );
  return {
    windowsRuntime,
    liveQualification,
    cleanupQualification: inspectCleanupReport(
      inputs.cleanupReport,
      configuration.profile,
      liveQualification,
      candidateBinding,
    ),
  };
}

export function isCandidateReady(context) {
  return candidateRequirements(context).every(Boolean);
}

function candidateRequirements(context) {
  return [
    context.sourceGatesPassed,
    context.repository.state === "clean",
    context.artifact?.formatValid,
    context.qualificationUtility?.formatValid,
    context.configuration.valid,
    context.configuration.diagnosticsEnabled === false,
    context.artifact?.embeddedSecretScanPassed,
    context.qualificationUtility?.embeddedSecretScanPassed,
    context.artifact?.signatureStatus === "not_signed",
    context.windowsRuntime.status === "passed",
  ];
}

function isPilotQualified(candidateReady, configuration, qualifications) {
  const cleanupPassed =
    configuration.profile === "read_only" ||
    qualifications.cleanupQualification.status === "passed";
  return Boolean(
    candidateReady &&
      qualifications.liveQualification.status === "passed" &&
      cleanupPassed,
  );
}

function writeSupplementalEvidence(repository, configuration, artifact) {
  writeJson("source-revision-state.json", repository);
  writeJson(
    "configuration-fingerprint.json",
    configurationFingerprint(configuration),
  );
  writeJson("embedded-secret-scan.json", embeddedSecretScan(artifact));
  if (artifact) writeMsiSha256(artifact);
}

function configurationFingerprint(configuration) {
  return {
    profile: configuration.profile,
    valid: configuration.valid,
    fingerprintSha256: configuration.fingerprintSha256,
    failures: configuration.failures,
    writesEnabled: configuration.writesEnabled,
    diagnosticsEnabled: configuration.diagnosticsEnabled,
  };
}

function embeddedSecretScan(artifact) {
  if (!artifact) return { artifact: null, passed: false, forbiddenMarkers: [] };
  return {
    artifact: artifact.name,
    passed: artifact.embeddedSecretScanPassed,
    forbiddenMarkers: artifact.forbiddenMarkers,
  };
}

function writeMsiSha256(artifact) {
  fs.writeFileSync(
    resolve(evidenceDirectory, "msi-sha256.txt"),
    `${artifact.sha256}  ${artifact.name}\n`,
    { mode: 0o600 },
  );
}

function createEvidence(context) {
  return {
    schemaVersion: 6,
    version,
    profile: context.configuration.profile,
    candidateReady: context.candidateReady,
    pilotQualified: context.pilotQualified,
    signed: context.artifact?.signed ?? false,
    distributable: false,
    writesEnabled: context.configuration.writesEnabled,
    diagnosticsEnabled: context.configuration.diagnosticsEnabled,
    sourceGatesPassed: context.sourceGatesPassed,
    sourceGateNames,
    repository: context.repository,
    tools: installedTools(),
    gates: context.gates,
    sourceTreeSha256: context.sourceTree.sha256,
    sourceFileCount: context.sourceTree.files.length,
    sourceFiles: context.sourceTree.files,
    qualificationConfiguration: context.configuration,
    windowsArtifact: context.artifact,
    qualificationUtility: context.qualificationUtility,
    windowsRuntime: context.qualifications.windowsRuntime,
    ...qualificationEvidence(context.configuration, context.qualifications),
    excludedGates: {
      relutionApplicationUninstall: "not_run",
      administrativeOperations: "not_run",
      productionQualification: "not_run",
      signing: "not_run",
      publication: "not_run",
    },
  };
}

function installedTools() {
  return {
    node: process.version,
    pnpm: commandOutput(root, "pnpm", ["--version"]),
    rustc: commandOutput(root, "rustc", ["--version"]),
    cargo: commandOutput(root, "cargo", ["--version"]),
  };
}

function qualificationEvidence(configuration, qualifications) {
  const isReadOnly = configuration.profile === "read_only";
  return {
    readOnlyTenant: isReadOnly
      ? qualifications.liveQualification
      : notRun("write_qualification profile"),
    actionQualification: isReadOnly
      ? notRun("read_only profile")
      : qualifications.liveQualification,
    cleanupQualification: isReadOnly
      ? notRun("read_only profile")
      : qualifications.cleanupQualification,
  };
}

function setExitStatus(
  inputs,
  sourceGatesPassed,
  candidateReady,
  pilotQualified,
) {
  if (
    evidenceGenerationFailed(
      inputs,
      candidateReady,
      pilotQualified,
      sourceGatesPassed,
    )
  )
    process.exitCode = 1;
}

function evidenceGenerationFailed(
  inputs,
  candidateReady,
  pilotQualified,
  sourceGatesPassed,
) {
  return [
    !sourceGatesPassed,
    Boolean(inputs.msi && !candidateReady),
    Boolean(inputs.liveReport && !pilotQualified),
  ].some(Boolean);
}

function writeJson(name, value) {
  fs.writeFileSync(
    resolve(evidenceDirectory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function ensureDirectory(path) {
  fs.mkdirSync(path, { recursive: true, mode: 0o700 });
}
