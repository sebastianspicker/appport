import { spawnSync } from "node:child_process";
import process from "node:process";

import { hash } from "./io.mjs";
import { sourceVerificationEnvironment } from "../source-gates.mjs";

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
