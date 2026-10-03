import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseArguments } from "./create-alpha-evidence.mjs";
import {
  authenticodeInvocation,
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

test("Authenticode passes an untrusted artifact path as data", () => {
  const firstPath = String.raw`C:\release\candidate’; Write-Output injected; '.msi`;
  const secondPath = String.raw`C:\release\$(Write-Output injected)[x].msi`;
  const first = authenticodeInvocation(firstPath);
  const second = authenticodeInvocation(secondPath);

  assert.equal(first.executable, "powershell.exe");
  assert.deepEqual(first.arguments, second.arguments);
  assert.equal(first.options.env.APPPORT_AUTHENTICODE_TARGET, firstPath);
  assert.equal(second.options.env.APPPORT_AUTHENTICODE_TARGET, secondPath);
  assert.equal(first.arguments.join(" ").includes(firstPath), false);
  assert.equal(second.arguments.join(" ").includes(secondPath), false);
  assert.match(
    first.arguments.at(-1),
    /-LiteralPath \$env:APPPORT_AUTHENTICODE_TARGET/,
  );
});
