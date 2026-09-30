import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

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
