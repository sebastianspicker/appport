import { spawnSync } from "node:child_process";
import process from "node:process";

import { hash } from "./io.mjs";
import { sourceVerificationEnvironment } from "../source-gates.mjs";

/**
 * Runs each gate and records only a digest of its output. `onFailure`, when given,
 * receives the name and captured output of each failed gate for diagnostics.
 */
export function runGateCommands(root, gateCommands, onFailure) {
  return gateCommands.map(([name, executable, args]) =>
    runGate(root, name, executable, args, onFailure),
  );
}

export function commandOutput(root, executable, args) {
  return commandRaw(root, executable, args).trim();
}

/**
 * Starts a command without a shell, except pnpm on Windows: there it is a .cmd shim,
 * which Node starts only through a shell. Arguments are joined unescaped, so any
 * argument with spaces or shell metacharacters is refused.
 */
export function spawnCommand(executable, args, options) {
  if (process.platform !== "win32" || executable !== "pnpm")
    return spawnSync(executable, args, options);
  const unsafe = args.find((argument) => !/^[\w:./=-]+$/.test(argument));
  if (unsafe !== undefined)
    throw new Error(
      `refusing to pass ${JSON.stringify(unsafe)} through a shell`,
    );
  return spawnSync([executable, ...args].join(" "), {
    ...options,
    shell: true,
  });
}

export function commandRaw(root, executable, args) {
  const result = spawnCommand(executable, args, {
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

function runGate(root, name, executable, args, onFailure) {
  const started = process.hrtime.bigint();
  const result = spawnCommand(executable, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...sourceVerificationEnvironment },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const exitStatus = result.status ?? 1;
  if (exitStatus !== 0) onFailure?.(name, output || String(result.error ?? ""));
  return {
    name,
    command: [executable, ...args].join(" "),
    exitStatus,
    durationMs: Math.round(
      Number(process.hrtime.bigint() - started) / 1_000_000,
    ),
    outputSha256: hash(output),
  };
}
