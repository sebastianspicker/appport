import { spawnSync } from "node:child_process";
import process from "node:process";

import { hash } from "./io.mjs";

const sourceVerificationEnvironment = {
  APPPORT_SOURCE_VERIFICATION: "true",
  APPPORT_RELUTION_API_BASE_URL: "https://source-verification.invalid",
  APPPORT_RELUTION_ORGANIZATION_UUID: "10000000-0000-4000-8000-000000000001",
  APPPORT_NATIVE_APP_UUID: "20000000-0000-4000-8000-000000000002",
  APPPORT_QUALIFICATION_PROFILE: "read_only",
  APPPORT_RELUTION_WRITES_ENABLED: "false",
  APPPORT_RELUTION_DIAGNOSTICS: "false",
  APPPORT_RELUTION_PASSWORD_AUTH_ENABLED: "false",
  APPPORT_RELUTION_PASSWORD_AUTH_CONTRACT: "none",
  APPPORT_QUALIFICATION_TENANT_APPROVED: "",
  APPPORT_RELUTION_TENANT_CLASS: "",
  APPPORT_DISPOSABLE_RESOURCES_APPROVED: "",
};

export function runGateCommands(root, gateCommands) {
  return gateCommands.map(([name, executable, args]) =>
    runGate(root, name, executable, args),
  );
}

export function commandOutput(root, executable, args) {
  return commandRaw(root, executable, args).trim();
}

export function commandRaw(root, executable, args) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `${[executable, ...args].join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.replace(/\n$/, "");
}

function runGate(root, name, executable, args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...sourceVerificationEnvironment },
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
