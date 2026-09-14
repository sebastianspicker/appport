#!/usr/bin/env node

import { resolve } from "node:path";

import { runGateCommands } from "./alpha-evidence/commands.mjs";
import { sourceGateCommands } from "./source-gates.mjs";

const root = resolve(import.meta.dirname, "..");
const gateFlag = process.argv.indexOf("--gate");
const requestedGate = gateFlag === -1 ? undefined : process.argv[gateFlag + 1];
const selectedCommands = requestedGate
  ? sourceGateCommands.filter(([name]) => name === requestedGate)
  : sourceGateCommands;

if (requestedGate && selectedCommands.length === 0) {
  throw new Error(`Unknown source gate: ${requestedGate}`);
}

const gates = runGateCommands(root, selectedCommands);

for (const gate of gates) {
  const status = gate.exitStatus === 0 ? "passed" : "failed";
  console.log(`${status}: ${gate.name} (${gate.durationMs}ms)`);
}

if (gates.some((gate) => gate.exitStatus !== 0)) process.exitCode = 1;
