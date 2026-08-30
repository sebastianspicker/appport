import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  configurationFailures,
  inspectConfiguration,
} from "./configuration.mjs";
import {
  inspectCleanupReport,
  inspectReport,
  isCandidateReady,
} from "../create-alpha-evidence.mjs";

const ready = {
  APPPORT_RELUTION_API_BASE_URL: "https://qualification.example.net",
  APPPORT_RELUTION_ORGANIZATION_UUID: "11111111-2222-4333-8444-555555555555",
  APPPORT_NATIVE_APP_UUID: "66666666-7777-4888-8999-aabbccddeeff",
  APPPORT_QUALIFICATION_PROFILE: "read_only",
  APPPORT_RELUTION_WRITES_ENABLED: "false",
  APPPORT_RELUTION_DIAGNOSTICS: "false",
  APPPORT_QUALIFICATION_TENANT_APPROVED: "true",
  APPPORT_RELUTION_TENANT_CLASS: "qualification",
  APPPORT_DISPOSABLE_RESOURCES_APPROVED: "false",
};

test("qualification evidence accepts only a ready read-only configuration", () => {
  const inspection = inspectConfiguration(ready);
  assert.equal(inspection.valid, true);
  assert.equal(inspection.profile, "read_only");
  assert.equal(inspection.writesEnabled, false);
  assert.match(inspection.fingerprintSha256, /^[a-f0-9]{64}$/);
});

test("qualification evidence fails closed on readiness and binding-relevant mismatches", () => {
  const failures = configurationFailures({
    origin: "https://qualification.example.net",
    organization: ready.APPPORT_RELUTION_ORGANIZATION_UUID,
    nativeApp: ready.APPPORT_NATIVE_APP_UUID,
    profile: "read_only",
    writes: "true",
    diagnostics: "maybe",
    tenantApproved: "false",
    tenantClass: "production",
    disposableApproved: "false",
  });
  assert.deepEqual(failures, [
    "writes do not exactly match profile",
    "diagnostics must be exactly true or false",
    "qualification tenant is not approved",
    "tenant class is not qualification",
  ]);

  const configuration = inspectConfiguration(ready);
  const candidate = {
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
  assert.equal(isCandidateReady(candidate), true);
  for (const incomplete of [
    { ...candidate, sourceGatesPassed: false },
    { ...candidate, repository: { state: "dirty" } },
    { ...candidate, windowsRuntime: { status: "failed" } },
  ]) {
    assert.equal(isCandidateReady(incomplete), false);
  }
});

test("qualification and cleanup reports remain bound to the exact candidate and plan", () => {
  const directory = mkdtempSync(join(tmpdir(), "appport-evidence-"));
  const livePath = join(directory, "live.json");
  const cleanupPath = join(directory, "cleanup.json");
  const binding = {
    candidateMsiSha256: "a".repeat(64),
    qualificationUtilitySha256: "b".repeat(64),
    configurationFingerprintSha256: "c".repeat(64),
    sourceRevision: "d".repeat(40),
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
  ].map((name) => ({ name, status: "passed" }));
  const liveReport = {
    schemaVersion: 1,
    profile: "write_qualification",
    qualified: true,
    writesEnabled: true,
    diagnosticsEnabled: false,
    tokenRedacted: true,
    startedAtUnix: 10,
    completedAtUnix: 20,
    planFingerprintSha256: "e".repeat(64),
    ...binding,
    checks,
  };
  try {
    writeFileSync(livePath, JSON.stringify(liveReport));
    const live = inspectReport(
      livePath,
      "live_qualification",
      "write_qualification",
      true,
      binding,
    );
    assert.equal(live.status, "passed");
    for (const field of Object.keys(binding)) {
      writeFileSync(
        livePath,
        JSON.stringify({
          ...liveReport,
          [field]: "f".repeat(field === "sourceRevision" ? 40 : 64),
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
        field,
      );
    }
    writeFileSync(
      cleanupPath,
      JSON.stringify({
        schemaVersion: 1,
        profile: "write_qualification",
        qualified: true,
        cleanupComplete: true,
        completedAtUnix: 30,
        planFingerprintSha256: "f".repeat(64),
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
