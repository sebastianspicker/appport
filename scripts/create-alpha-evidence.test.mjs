import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseArguments } from "./create-alpha-evidence.mjs";
import {
  inspectMsiArtifact,
  inspectQualificationUtility,
} from "./alpha-evidence/artifacts.mjs";

test("alpha evidence accepts MSI and EXE inputs only with a Windows self-check", () => {
  assert.throws(() => parseArguments(["--msi", "candidate.msi"]));
  const inputs = parseArguments([
    "--msi",
    "candidate.msi",
    "--qualification-utility",
    "qualification.exe",
    "--windows-self-check",
    "self-check.json",
  ]);
  assert.match(inputs.msi, /candidate\.msi$/);
  assert.match(inputs.qualificationUtility, /qualification\.exe$/);
  assert.match(inputs.windowsSelfCheck, /self-check\.json$/);
});

test("artifact inspection distinguishes MSI and EXE signatures", () => {
  const directory = mkdtempSync(join(tmpdir(), "appport-evidence-"));
  try {
    const msi = join(directory, "candidate.msi");
    const exe = join(directory, "qualification.exe");
    const invalidMsi = join(directory, "invalid.msi");
    const invalidExe = join(directory, "invalid.exe");
    writeFileSync(
      msi,
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    );
    writeFileSync(exe, Buffer.from([0x4d, 0x5a, 0, 0]));
    writeFileSync(invalidMsi, "not an artifact");
    writeFileSync(invalidExe, "not an artifact");
    assert.equal(inspectMsiArtifact(msi, []).formatValid, true);
    assert.equal(inspectQualificationUtility(exe, []).formatValid, true);
    assert.equal(inspectMsiArtifact(invalidMsi, []).formatValid, false);
    assert.equal(
      inspectQualificationUtility(invalidExe, []).formatValid,
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
