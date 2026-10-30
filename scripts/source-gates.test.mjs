import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { runGateCommands } from "./alpha-evidence/commands.mjs";
import {
  sourceGateCommands,
  sourceGateCompositionFailures,
} from "./source-gates.mjs";

const root = resolve(import.meta.dirname, "..");
const scripts = JSON.parse(readFileSync(resolve(root, "package.json"))).scripts;

test("source gates compose static quality and dedicated Clippy once", () => {
  assert.deepEqual(sourceGateCompositionFailures(scripts), []);
});

test("source gate composition rejects nested or duplicate Clippy", () => {
  const commands = sourceGateCommands.map((command) => [...command]);
  commands.find(([name]) => name === "quality")[2] = ["quality:source"];
  commands.push(["extra-clippy", "pnpm", ["rust:clippy"]]);

  assert.deepEqual(sourceGateCompositionFailures(scripts, commands), [
    "quality gate must invoke pnpm quality:source:static exactly once",
    "aggregate source gates must run dedicated Clippy exactly once",
  ]);
});

test("source gate composition rejects weakened static quality", () => {
  assert.deepEqual(
    sourceGateCompositionFailures({
      ...scripts,
      "quality:source:static": "pnpm quality:lint:source",
    }),
    [
      "quality:source:static must invoke quality:style:source",
      "quality:source:static must invoke quality:size:source",
      "quality:source:static must invoke quality:duplicates:source",
    ],
  );
});

test("gate runner reports the output of failed gates only", () => {
  const failures = [];
  const node = process.execPath;
  const gates = runGateCommands(
    root,
    [
      ["passing", node, ["-e", "console.log('quiet')"]],
      ["failing", node, ["-e", "console.error('gate broke'); process.exit(3)"]],
    ],
    (name, output) => failures.push([name, output.trim()]),
  );

  assert.deepEqual(
    gates.map(({ name, exitStatus }) => [name, exitStatus]),
    [
      ["passing", 0],
      ["failing", 3],
    ],
  );
  assert.deepEqual(failures, [["failing", "gate broke"]]);
  assert.equal(Object.hasOwn(gates[1], "output"), false);
});
