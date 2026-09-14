import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  demoPagesWorkflowFailures,
  verificationWorkflowFailures,
} from "./workflow-contracts.mjs";

const root = resolve(import.meta.dirname, "..");
const scripts = JSON.parse(readFileSync(resolve(root, "package.json"))).scripts;
const verifyWorkflow = readFileSync(
  resolve(root, ".github/workflows/verify.yml"),
  "utf8",
);
const pagesWorkflow = readFileSync(
  resolve(root, ".github/workflows/demo-pages.yml"),
  "utf8",
);

test("PR and main verification run the demo independently", () => {
  assert.deepEqual(verificationWorkflowFailures(verifyWorkflow, scripts), []);
});

test("verification rejects a dependent demo job", () => {
  const fixture = verifyWorkflow.replace(
    "  demo:\n    name:",
    "  demo:\n    needs: source\n    name:",
  );
  assert.deepEqual(verificationWorkflowFailures(fixture, scripts), [
    "verify demo job must remain independent",
  ]);
});

test("Pages builds and deploys only the isolated demo artifact", () => {
  assert.deepEqual(demoPagesWorkflowFailures(pagesWorkflow, scripts), []);
});

test("Pages rejects missing shared inputs and desktop stylesheet coupling", () => {
  const fixture = pagesWorkflow
    .replace('      - "jscpd.demo.json"\n', "")
    .replace(
      '      - "apps/web-demo/**"\n',
      '      - "apps/web-demo/**"\n      - "apps/windows-client/src/styles.css"\n',
    );
  assert.deepEqual(demoPagesWorkflowFailures(fixture, scripts), [
    "Pages workflow path trigger is missing jscpd.demo.json",
    "Pages workflow must not depend on the desktop stylesheet",
  ]);
});

test("Pages rejects pull-request deploys and a non-demo artifact", () => {
  const fixture = pagesWorkflow
    .replace(
      "  workflow_dispatch:\n",
      "  pull_request:\n  workflow_dispatch:\n",
    )
    .replace("path: apps/web-demo/dist", "path: apps/windows-client/dist");
  assert.deepEqual(demoPagesWorkflowFailures(fixture, scripts), [
    "Pages workflow must run only for pushes and manual dispatch",
    "Pages build job must upload only the demo dist artifact",
  ]);
});
