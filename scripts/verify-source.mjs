#!/usr/bin/env node

import { resolve } from "node:path";

import { runGateCommands } from "./alpha-evidence/commands.mjs";
import { sourceGateCommands } from "./source-gates.mjs";

const root = resolve(import.meta.dirname, "..");
const gates = runGateCommands(root, sourceGateCommands);

for (const gate of gates) {
  const status = gate.exitStatus === 0 ? "passed" : "failed";
  console.log(`${status}: ${gate.name} (${gate.durationMs}ms)`);
}

if (gates.some((gate) => gate.exitStatus !== 0)) process.exitCode = 1;
