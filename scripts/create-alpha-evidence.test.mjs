import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  configurationFailures,
  inspectCleanupReport,
  inspectConfiguration,
  inspectReport,
  isCandidateReady,
  parseArguments,
} from "./create-alpha-evidence.mjs";
import {
  inspectMsiArtifact,
  inspectQualificationUtility,
} from "./alpha-evidence/artifacts.mjs";

const baseConfiguration = {
  origin: "https://qualification.internal.example.org",
  organization: "10000000-0000-4000-8000-000000000001",
  nativeApp: "20000000-0000-4000-8000-000000000002",
  profile: "read_only",
  writes: "false",
  diagnostics: "false",
  passwordAuthEnabled: "false",
  passwordAuthContract: "none",
  tenantApproved: "true",
  tenantClass: "qualification",
  disposableApproved: "",
};

test("configuration profiles match exact write and approval flags", () => {
  assert.deepEqual(configurationFailures(baseConfiguration), []);
  assert(
    configurationFailures({ ...baseConfiguration, writes: "False" }).length > 0,
  );
  assert(
    configurationFailures({
      ...baseConfiguration,
      profile: "write_qualification",
      writes: "true",
    }).includes("disposable resources are not approved"),
  );
  assert.deepEqual(
    configurationFailures({
      ...baseConfiguration,
      profile: "write_qualification",
      writes: "true",
      disposableApproved: "true",
    }),
    [],
  );
});

test("diagnostic and password-auth configuration cannot be candidate-ready", () => {
  const environment = {
    APPPORT_RELUTION_API_BASE_URL: baseConfiguration.origin,
    APPPORT_RELUTION_ORGANIZATION_UUID: baseConfiguration.organization,
    APPPORT_NATIVE_APP_UUID: baseConfiguration.nativeApp,
    APPPORT_QUALIFICATION_PROFILE: baseConfiguration.profile,
    APPPORT_RELUTION_WRITES_ENABLED: baseConfiguration.writes,
    APPPORT_RELUTION_DIAGNOSTICS: "false",
    APPPORT_RELUTION_PASSWORD_AUTH_ENABLED:
      baseConfiguration.passwordAuthEnabled,
    APPPORT_RELUTION_PASSWORD_AUTH_CONTRACT:
      baseConfiguration.passwordAuthContract,
    APPPORT_QUALIFICATION_TENANT_APPROVED: baseConfiguration.tenantApproved,
    APPPORT_RELUTION_TENANT_CLASS: baseConfiguration.tenantClass,
    APPPORT_DISPOSABLE_RESOURCES_APPROVED: baseConfiguration.disposableApproved,
  };
  const normal = inspectConfiguration(environment);
  const diagnostic = inspectConfiguration({
    ...environment,
    APPPORT_RELUTION_DIAGNOSTICS: "true",
  });
  assert.equal(normal.valid, true);
  assert.equal(normal.diagnosticsEnabled, false);
  assert.equal(
    normal.fingerprintSha256,
    sha256(
      `origin=${baseConfiguration.origin}\norganization=${baseConfiguration.organization}\nnativeApplication=${baseConfiguration.nativeApp}\nprofile=${baseConfiguration.profile}\nwrites=${baseConfiguration.writes}\ndiagnostics=false\npasswordAuthEnabled=false\npasswordAuthContract=none\ntenantApproved=${baseConfiguration.tenantApproved}\ntenantClass=${baseConfiguration.tenantClass}\ndisposableApproved=${baseConfiguration.disposableApproved}\n`,
    ),
  );
  assert.equal(diagnostic.valid, true);
  assert.equal(diagnostic.diagnosticsEnabled, true);
  assert.notEqual(normal.fingerprintSha256, diagnostic.fingerprintSha256);
  assert.equal(isCandidateReady(candidateContext(normal)), true);
  assert.equal(isCandidateReady(candidateContext(diagnostic)), false);
  const passwordAuthEnabled = inspectConfiguration({
    ...environment,
    APPPORT_RELUTION_PASSWORD_AUTH_ENABLED: "true",
  });
  assert.equal(passwordAuthEnabled.valid, false);
  assert.equal(isCandidateReady(candidateContext(passwordAuthEnabled)), false);
  const passwordAuthContract = inspectConfiguration({
    ...environment,
    APPPORT_RELUTION_PASSWORD_AUTH_CONTRACT: "exchange-v1",
  });
  assert.equal(passwordAuthContract.valid, false);
  assert.equal(isCandidateReady(candidateContext(passwordAuthContract)), false);
  assert(
    configurationFailures({
      ...baseConfiguration,
      diagnostics: "True",
    }).includes("diagnostics must be exactly true or false"),
  );
});

test("qualification origins reject credentials, routes, and placeholder hosts", () => {
  for (const origin of [
    "https://operator@qualification.internal.example.org",
    "https://qualification.internal.example.org/tenant",
    "https://qualification.example.test",
    "https://qualification.invalid",
  ]) {
    assert(
      configurationFailures({ ...baseConfiguration, origin }).includes(
        "invalid qualification-tenant origin",
      ),
    );
  }
});

test("artifact arguments require the installed-MSI self-check", () => {
  assert.throws(() => parseArguments(["--msi", "candidate.msi"]));
  const parsed = parseArguments([
    "--msi",
    "candidate.msi",
    "--qualification-utility",
    "qualification.exe",
    "--windows-self-check",
    "self-check.json",
  ]);
  assert(parsed.msi.endsWith("candidate.msi"));
  assert(parsed.qualificationUtility.endsWith("qualification.exe"));
  assert(parsed.windowsSelfCheck.endsWith("self-check.json"));
  assert.throws(() =>
    parseArguments([
      "--live-report",
      "first.json",
      "--live-report",
      "second.json",
    ]),
  );
  assert.throws(() => parseArguments(["--cleanup-report", "cleanup.json"]));
});

test("artifact inspection validates MSI and EXE headers without crashing", () => {
  const directory = mkdtempSync(join(tmpdir(), "appport-artifact-evidence-"));
  try {
    const validMsi = join(directory, "candidate.msi");
    const invalidMsi = join(directory, "candidate-invalid.msi");
    const validExe = join(directory, "qualification.exe");
    const invalidExe = join(directory, "qualification-invalid.exe");
    writeFileSync(
      validMsi,
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]),
    );
    writeFileSync(invalidMsi, Buffer.from("not an MSI", "utf8"));
    writeFileSync(validExe, Buffer.from([0x4d, 0x5a, 0, 0]));
    writeFileSync(invalidExe, Buffer.from("not an EXE", "utf8"));

    assert.equal(inspectMsiArtifact(validMsi, []).formatValid, true);
    assert.equal(inspectMsiArtifact(invalidMsi, []).formatValid, false);
    assert.equal(inspectQualificationUtility(validExe, []).formatValid, true);
    assert.equal(
      inspectQualificationUtility(invalidExe, []).formatValid,
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("live and cleanup reports must match profile, redaction, and plan fingerprint", () => {
  const directory = mkdtempSync(join(tmpdir(), "appport-evidence-"));
  try {
    const livePath = join(directory, "live.json");
    const binding = {
      candidateMsiSha256: "b".repeat(64),
      qualificationUtilitySha256: "d".repeat(64),
      configurationFingerprintSha256: "c".repeat(64),
      sourceRevision: "701aa9a",
    };
    const checks = [
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
      "qualification_plan",
      "write_device_binding",
      "install_fixture",
      "update_fixture",
      "unauthorized_application",
      "substituted_version",
      "cross_user_action",
      "approved_install",
      "approved_update",
    ].map((name) => ({ name, status: "passed", detail: "redacted" }));
    writeFileSync(
      livePath,
      JSON.stringify({
        schemaVersion: 1,
        profile: "write_qualification",
        qualified: true,
        writesEnabled: true,
        diagnosticsEnabled: false,
        passwordAuthEnabled: false,
        passwordAuthContract: "none",
        tokenRedacted: true,
        startedAtUnix: 10,
        completedAtUnix: 20,
        planFingerprintSha256: "a".repeat(64),
        ...binding,
        checks,
      }),
    );
    const live = inspectReport(
      livePath,
      "live_qualification",
      "write_qualification",
      true,
      binding,
    );
    assert.equal(live.status, "passed");
    writeFileSync(
      livePath,
      JSON.stringify({
        ...JSON.parse(read(livePath)),
        diagnosticsEnabled: true,
      }),
    );
    assert.equal(
      inspectReport(
        livePath,
        "live_qualification",
        "write_qualification",
        true,
        binding,
      ).status,
      "failed",
    );
    writeFileSync(
      livePath,
      JSON.stringify({
        ...JSON.parse(read(livePath)),
        diagnosticsEnabled: false,
      }),
    );
    writeFileSync(
      livePath,
      JSON.stringify({
        ...JSON.parse(read(livePath)),
        passwordAuthEnabled: true,
      }),
    );
    assert.equal(
      inspectReport(
        livePath,
        "live_qualification",
        "write_qualification",
        true,
        binding,
      ).status,
      "failed",
    );
    writeFileSync(
      livePath,
      JSON.stringify({
        ...JSON.parse(read(livePath)),
        passwordAuthEnabled: false,
        passwordAuthContract: "exchange-v1",
      }),
    );
    assert.equal(
      inspectReport(
        livePath,
        "live_qualification",
        "write_qualification",
        true,
        binding,
      ).status,
      "failed",
    );
    writeFileSync(
      livePath,
      JSON.stringify({
        ...JSON.parse(read(livePath)),
        passwordAuthContract: "none",
      }),
    );
    const cleanupPath = join(directory, "cleanup.json");
    writeFileSync(
      cleanupPath,
      JSON.stringify({
        schemaVersion: 1,
        profile: "write_qualification",
        qualified: true,
        cleanupComplete: true,
        completedAtUnix: 30,
        planFingerprintSha256: "a".repeat(64),
        ...binding,
      }),
    );
    assert.equal(
      inspectCleanupReport(cleanupPath, "write_qualification", live, binding)
        .status,
      "passed",
    );
    writeFileSync(
      livePath,
      JSON.stringify({ ...JSON.parse(read(livePath)), tokenRedacted: false }),
    );
    assert.equal(
      inspectReport(
        livePath,
        "live_qualification",
        "write_qualification",
        true,
        binding,
      ).status,
      "failed",
    );
    writeFileSync(
      cleanupPath,
      JSON.stringify({
        schemaVersion: 1,
        profile: "write_qualification",
        qualified: true,
        cleanupComplete: true,
        completedAtUnix: 19,
        planFingerprintSha256: "a".repeat(64),
        ...binding,
      }),
    );
    assert.equal(
      inspectCleanupReport(cleanupPath, "write_qualification", live, binding)
        .status,
      "failed",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows self-check producer and workflow enrichment bind the candidate", () => {
  const directory = mkdtempSync(join(tmpdir(), "appport-windows-evidence-"));
  try {
    const path = join(directory, "self-check.json");
    const sourceRevision = "a".repeat(40);
    const msi = Buffer.from("candidate MSI");
    const qualificationUtilityPath = join(directory, "qualification.exe");
    const qualificationUtility = Buffer.from([
      0x4d,
      0x5a,
      ...Buffer.from("candidate utility"),
    ]);
    writeFileSync(qualificationUtilityPath, qualificationUtility);
    const binding = {
      candidateMsiSha256: sha256(msi),
      qualificationUtilitySha256: sha256(qualificationUtility),
      configurationFingerprintSha256: "c".repeat(64),
      sourceRevision,
    };
    const rustReport = {
      schemaVersion: 1,
      profile: "read_only",
      qualified: true,
      writesEnabled: false,
      diagnosticsEnabled: false,
      passwordAuthEnabled: false,
      passwordAuthContract: "none",
      cleanupComplete: true,
      startedAtUnix: 10,
      completedAtUnix: 20,
      configurationFingerprintSha256: binding.configurationFingerprintSha256,
      sourceRevision,
      checks: [
        "qualification_build",
        "credential_manager",
        "journal_acl",
        "protocol_and_scheduled_task",
        "notification_registry",
        "graceful_native_startup",
      ].map((name) => ({ name, status: "passed" })),
    };
    const report = enrichWindowsSelfCheck(
      rustReport,
      msi,
      qualificationUtility,
      sourceRevision,
    );
    writeFileSync(path, JSON.stringify(report));
    assert.equal(
      inspectReport(path, "windows_runtime", "read_only", false, binding)
        .status,
      "passed",
    );
    assert.equal(
      inspectQualificationUtility(qualificationUtilityPath, []).sha256,
      binding.qualificationUtilitySha256,
    );
    writeFileSync(
      qualificationUtilityPath,
      Buffer.from([0x4d, 0x5a, ...Buffer.from("replacement utility")]),
    );
    const replacementBinding = {
      ...binding,
      qualificationUtilitySha256: inspectQualificationUtility(
        qualificationUtilityPath,
        [],
      ).sha256,
    };
    assert.equal(
      inspectReport(
        path,
        "windows_runtime",
        "read_only",
        false,
        replacementBinding,
      ).status,
      "failed",
    );
    const workflow = read(".github/workflows/verify.yml");
    assert.match(
      workflow,
      /Get-FileHash -Algorithm SHA256 -LiteralPath \$env:APPPORT_MSI\)\.Hash\.ToLowerInvariant\(\)/,
    );
    assert.match(
      workflow,
      /Get-FileHash -Algorithm SHA256 -LiteralPath \$env:APPPORT_QUALIFICATION_UTILITY\)\.Hash\.ToLowerInvariant\(\)/,
    );
    assert.match(
      workflow,
      /\$selfCheck\.sourceRevision -ne \$env:APPPORT_SOURCE_REVISION/,
    );
    assert.match(
      workflow,
      /Add-Member -NotePropertyName candidateMsiSha256 -NotePropertyValue \$candidateMsiSha256/,
    );
    assert.match(
      workflow,
      /Add-Member -NotePropertyName qualificationUtilitySha256 -NotePropertyValue \$qualificationUtilitySha256/,
    );
    assert.match(workflow, /APPPORT_RELUTION_DIAGNOSTICS: "false"/);
    assert.match(workflow, /\$selfCheck\.diagnosticsEnabled -ne \$false/);
    assert.match(workflow, /APPPORT_RELUTION_PASSWORD_AUTH_ENABLED: "false"/);
    assert.match(workflow, /APPPORT_RELUTION_PASSWORD_AUTH_CONTRACT: none/);
    assert.match(workflow, /\$selfCheck\.passwordAuthEnabled -ne \$false/);
    assert.match(workflow, /\$selfCheck\.passwordAuthContract -ne 'none'/);
    for (const field of [
      "candidateMsiSha256",
      "qualificationUtilitySha256",
      "sourceRevision",
    ]) {
      const missingBinding = { ...report };
      delete missingBinding[field];
      writeFileSync(path, JSON.stringify(missingBinding));
      assert.equal(
        inspectReport(path, "windows_runtime", "read_only", false, binding)
          .status,
        "failed",
      );
    }
    for (const [field, value] of [
      ["candidateMsiSha256", "e".repeat(64)],
      ["qualificationUtilitySha256", "e".repeat(64)],
      ["sourceRevision", "different-revision"],
    ]) {
      writeFileSync(path, JSON.stringify({ ...report, [field]: value }));
      assert.equal(
        inspectReport(path, "windows_runtime", "read_only", false, binding)
          .status,
        "failed",
      );
    }
    writeFileSync(path, JSON.stringify({ ...report, msiUninstalled: false }));
    assert.equal(
      inspectReport(path, "windows_runtime", "read_only", false, binding)
        .status,
      "failed",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function enrichWindowsSelfCheck(
  report,
  msi,
  qualificationUtility,
  sourceRevision,
) {
  assert.equal(report.sourceRevision, sourceRevision);
  return {
    ...report,
    msiUninstalled: true,
    installedExecutableSha256: "d".repeat(64),
    installedProductVersion: "0.1.0.4",
    candidateMsiSha256: sha256(msi),
    qualificationUtilitySha256: sha256(qualificationUtility),
  };
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function candidateContext(configuration) {
  return {
    sourceGatesPassed: true,
    repository: { state: "clean" },
    artifact: {
      formatValid: true,
      embeddedSecretScanPassed: true,
      signatureStatus: "not_signed",
    },
    qualificationUtility: {
      formatValid: true,
      embeddedSecretScanPassed: true,
    },
    configuration,
    windowsRuntime: { status: "passed" },
  };
}

function read(path) {
  return process.getBuiltinModule("node:fs").readFileSync(path, "utf8");
}
