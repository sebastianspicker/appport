import { resolve } from "node:path";

import { hash, readJson, readRegularFile, regularFileDigest } from "./io.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const wixVersion = readJson(
  resolve(repositoryRoot, "apps/windows-client/src-tauri/tauri.conf.json"),
).bundle.windows.wix.version;

const readOnlyChecks = [
  "profile_matches_write_flag",
  "user_b_identity",
  "user_b_device_match",
  "bootstrap",
  "apps_catalog",
  "updates_catalog",
  "installed_inventory",
  "background_bootstrap",
  "icon",
  "user_a_unassigned_isolation",
];
const writeChecks = [
  ...readOnlyChecks,
  "qualification_plan",
  "write_device_binding",
  "install_fixture",
  "update_fixture",
  "unauthorized_application",
  "substituted_version",
  "cross_user_action",
  "approved_install",
  "approved_update",
];
const windowsChecks = [
  "qualification_build",
  "credential_manager",
  "journal_acl",
  "protocol_and_scheduled_task",
  "notification_registry",
  "graceful_native_startup",
];

export function inspectReport(
  path,
  kind,
  expectedProfile,
  expectedWrites,
  expectedBinding = null,
) {
  if (!path) return notRun(`${kind} report not supplied`);
  try {
    const { contents } = readRegularFile(path, 1024 * 1024);
    const report = JSON.parse(contents.toString("utf8"));
    return inspectParsedReport(
      path,
      contents,
      report,
      reportContext(kind, expectedProfile, expectedWrites, expectedBinding),
    );
  } catch {
    return failedReport(path, {}, "report was unreadable or invalid JSON");
  }
}

export function inspectCleanupReport(
  path,
  expectedProfile,
  liveQualification,
  expectedBinding = null,
) {
  if (expectedProfile !== "write_qualification")
    return notRun("read_only profile");
  if (!path) return notRun("cleanup report not supplied");
  try {
    const { contents } = readRegularFile(path, 1024 * 1024);
    const report = JSON.parse(contents.toString("utf8"));
    return cleanupReportResult({
      contents,
      report,
      expectedProfile,
      liveQualification,
      expectedBinding,
    });
  } catch {
    return failedReport(
      path,
      {},
      "cleanup report was unreadable or invalid JSON",
    );
  }
}

function reportContext(kind, expectedProfile, expectedWrites, expectedBinding) {
  return {
    kind,
    expectedProfile,
    expectedWrites,
    expectedBinding,
    requiredChecks: requiredChecksFor(kind, expectedProfile),
  };
}

function inspectParsedReport(path, contents, report, context) {
  const failure = reportSpecificFailure(report, context);
  if (failure) return failedReport(path, report, failure);
  const valid =
    hasMatchingReportBasics(report, context) &&
    mandatoryChecksPassed(report.checks, context.requiredChecks);
  return reportResult(
    contents,
    report,
    valid,
    "report schema or profile did not match",
  );
}

function requiredChecksFor(kind, expectedProfile) {
  if (kind === "windows_runtime") return windowsChecks;
  return expectedProfile === "write_qualification"
    ? writeChecks
    : readOnlyChecks;
}

function hasMatchingReportBasics(report, context) {
  return (
    report.schemaVersion === 1 &&
    report.qualified === true &&
    report.profile === context.expectedProfile &&
    report.writesEnabled === context.expectedWrites &&
    report.diagnosticsEnabled === false &&
    hasOrderedTimestamps(report)
  );
}

function hasOrderedTimestamps(report) {
  return (
    Number.isSafeInteger(report.startedAtUnix) &&
    Number.isSafeInteger(report.completedAtUnix) &&
    report.completedAtUnix >= report.startedAtUnix
  );
}

function reportSpecificFailure(report, context) {
  if (context.kind === "windows_runtime")
    return windowsRuntimeFailure(report, context.expectedBinding);
  if (context.kind === "live_qualification")
    return liveQualificationFailure(
      report,
      context.expectedProfile,
      context.expectedBinding,
    );
  return null;
}

function windowsRuntimeFailure(report, expectedBinding) {
  if (report.cleanupComplete !== true)
    return "self-check cleanup was incomplete";
  if (report.msiUninstalled !== true)
    return "candidate MSI uninstall was not recorded";
  return installedIdentityFailure(report, expectedBinding);
}

function installedIdentityFailure(report, expectedBinding) {
  if (
    isSha256(report.installedExecutableSha256) &&
    report.installedProductVersion === wixVersion &&
    bindingMatches(report, expectedBinding)
  ) {
    return null;
  }
  return "installed executable identity did not match the MSI product";
}

function liveQualificationFailure(report, expectedProfile, expectedBinding) {
  if (report.tokenRedacted !== true)
    return "live report did not assert token redaction";
  if (
    bindingMatches(report, expectedBinding) &&
    (expectedProfile !== "write_qualification" ||
      isSha256(report.planFingerprintSha256))
  ) {
    return null;
  }
  return "live report was not bound to this candidate and plan";
}

function cleanupReportResult(context) {
  const valid = cleanupReportMatches(context);
  return {
    status: valid ? "passed" : "failed",
    completedAtUnix: context.report.completedAtUnix ?? null,
    outputSha256: hash(context.contents),
    planFingerprintSha256: context.report.planFingerprintSha256 ?? null,
    reason: valid ? null : "cleanup report did not match the qualified plan",
  };
}

function cleanupReportMatches(context) {
  return cleanupRequirements(context).every(Boolean);
}

function cleanupRequirements(context) {
  const { report } = context;
  return [
    report.schemaVersion === 1,
    report.profile === context.expectedProfile,
    report.qualified === true,
    report.cleanupComplete === true,
    Number.isSafeInteger(report.completedAtUnix),
    report.completedAtUnix >= context.liveQualification.completedAtUnix,
    isSha256(report.planFingerprintSha256),
    report.planFingerprintSha256 ===
      context.liveQualification.planFingerprintSha256,
    bindingMatches(report, context.expectedBinding),
  ];
}

function reportResult(contents, report, valid, failedReason) {
  const details = reportDetails(contents, report);
  if (valid) return { status: "passed", ...details, reason: null };
  return {
    status: "failed",
    ...details,
    reason: failedReason,
  };
}

function reportDetails(contents, report) {
  return {
    startedAtUnix: report.startedAtUnix ?? null,
    completedAtUnix: report.completedAtUnix ?? null,
    outputSha256: hash(contents),
    planFingerprintSha256: report.planFingerprintSha256 ?? null,
  };
}

function mandatoryChecksPassed(checks, required) {
  if (!Array.isArray(checks)) return false;
  return (
    hasUniqueValidChecks(checks) &&
    noFailedChecks(checks) &&
    includesRequiredChecks(checks, required)
  );
}

function hasUniqueValidChecks(checks) {
  const names = new Set();
  for (const check of checks) {
    if (!isUniqueValidCheck(check, names)) return false;
    names.add(check.name);
  }
  return true;
}

function isUniqueValidCheck(check, names) {
  return Boolean(
    check &&
      typeof check.name === "string" &&
      isKnownCheckStatus(check.status) &&
      !names.has(check.name),
  );
}

function isKnownCheckStatus(status) {
  return ["passed", "failed", "not_run"].includes(status);
}

function noFailedChecks(checks) {
  return !checks.some((check) => check.status === "failed");
}

function includesRequiredChecks(checks, required) {
  return required.every((name) =>
    checks.some((check) => check.name === name && check.status === "passed"),
  );
}

function bindingMatches(report, expected) {
  return Boolean(
    expected &&
      hasCompleteBinding(expected) &&
      bindingFieldsMatch(report, expected),
  );
}

function hasCompleteBinding(binding) {
  return [
    isSha256(binding.candidateMsiSha256),
    isSha256(binding.qualificationUtilitySha256),
    isSha256(binding.configurationFingerprintSha256),
    typeof binding.sourceRevision === "string",
    binding.sourceRevision.length > 0,
  ].every(Boolean);
}

function bindingFieldsMatch(report, expected) {
  return [
    report.candidateMsiSha256 === expected.candidateMsiSha256,
    report.qualificationUtilitySha256 === expected.qualificationUtilitySha256,
    report.configurationFingerprintSha256 ===
      expected.configurationFingerprintSha256,
    report.sourceRevision === expected.sourceRevision,
  ].every(Boolean);
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function failedReport(path, report, reason) {
  return {
    status: "failed",
    startedAtUnix: report.startedAtUnix ?? null,
    completedAtUnix: report.completedAtUnix ?? null,
    outputSha256: regularFileDigest(path),
    planFingerprintSha256: report.planFingerprintSha256 ?? null,
    reason,
  };
}

export function notRun(reason) {
  return {
    status: "not_run",
    startedAtUnix: null,
    completedAtUnix: null,
    outputSha256: null,
    planFingerprintSha256: null,
    reason,
  };
}
