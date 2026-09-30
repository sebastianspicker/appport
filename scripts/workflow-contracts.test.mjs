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

function mutate(text, from, to) {
  assert.ok(text.includes(from), `fixture is missing ${from}`);
  return text.replace(from, to);
}

test("the real workflows satisfy every contract", () => {
  assert.deepEqual(verificationWorkflowFailures(verifyWorkflow, scripts), []);
  assert.deepEqual(demoPagesWorkflowFailures(pagesWorkflow, scripts), []);
});

test("rejects a run step that invokes a missing package script", () => {
  const verify = mutate(verifyWorkflow, "pnpm verify:source", "pnpm gone");
  assert.deepEqual(verificationWorkflowFailures(verify, scripts), [
    "verify workflow invokes missing package script gone",
  ]);
  const pages = mutate(pagesWorkflow, "pnpm demo:verify", "pnpm gone");
  assert.deepEqual(demoPagesWorkflowFailures(pages, scripts), [
    "Pages workflow invokes missing package script gone",
    "Pages build job must run pnpm demo:verify",
  ]);
});

test("ignores pnpm install, exec, and --dir forms", () => {
  const fixture = mutate(
    verifyWorkflow,
    "pnpm verify:source",
    "pnpm exec tsc && pnpm --dir apps/web-demo run test && pnpm verify:source",
  );
  assert.deepEqual(verificationWorkflowFailures(fixture, scripts), []);
});

test("rejects actions that are not pinned to a commit SHA", () => {
  const verify = mutate(
    verifyWorkflow,
    "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
    "actions/checkout@v6",
  );
  assert.deepEqual(verificationWorkflowFailures(verify, scripts).slice(0, 1), [
    "verify workflow job source uses actions/checkout@v6 without a full commit SHA pin",
  ]);
  const pages = mutate(
    pagesWorkflow,
    "actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e",
    "actions/deploy-pages@d6db901",
  );
  assert.deepEqual(demoPagesWorkflowFailures(pages, scripts), [
    "Pages workflow job deploy uses actions/deploy-pages@d6db901 without a full commit SHA pin",
  ]);
});

test("rejects widened top-level permissions", () => {
  const verify = mutate(
    verifyWorkflow,
    "permissions:\n  contents: read\n",
    "permissions:\n  contents: write\n",
  );
  assert.deepEqual(verificationWorkflowFailures(verify, scripts), [
    "verify workflow top-level permissions must be exactly contents: read",
  ]);
  const pages = mutate(
    pagesWorkflow,
    "permissions:\n  contents: read\n\nconcurrency",
    "permissions:\n  contents: read\n  pages: write\n\nconcurrency",
  );
  assert.deepEqual(demoPagesWorkflowFailures(pages, scripts), [
    "Pages workflow top-level permissions must be exactly contents: read",
  ]);
});

test("only the Pages deploy job may add Pages permissions", () => {
  const verify = mutate(
    verifyWorkflow,
    "    needs: source\n",
    "    needs: source\n    permissions:\n      contents: read\n      pages: write\n      id-token: write\n",
  );
  assert.deepEqual(verificationWorkflowFailures(verify, scripts), [
    "verify workflow job windows must not widen permissions",
  ]);
  const pages = mutate(
    pagesWorkflow,
    "      id-token: write\n",
    "      id-token: write\n      packages: write\n",
  );
  assert.deepEqual(demoPagesWorkflowFailures(pages, scripts), [
    "Pages workflow job deploy must not widen permissions",
  ]);
});

test("verification rejects a dependent or missing demo job", () => {
  const dependent = mutate(
    verifyWorkflow,
    "  demo:\n    name:",
    "  demo:\n    needs: source\n    name:",
  );
  assert.deepEqual(verificationWorkflowFailures(dependent, scripts), [
    "verify demo job must remain independent",
  ]);
  const renamed = mutate(verifyWorkflow, "  demo:\n", "  browser:\n");
  assert.deepEqual(verificationWorkflowFailures(renamed, scripts), [
    "verify workflow is missing an independent demo job",
  ]);
});

test("verification rejects a demo job that skips demo:verify", () => {
  const fixture = mutate(verifyWorkflow, "pnpm demo:verify", "pnpm demo:check");
  assert.deepEqual(verificationWorkflowFailures(fixture, scripts), [
    "verify demo job must run pnpm demo:verify",
  ]);
});

test("Pages rejects pull-request triggers and non-main branches", () => {
  const pullRequest = mutate(
    pagesWorkflow,
    "  workflow_dispatch:\n",
    "  pull_request:\n  workflow_dispatch:\n",
  );
  assert.deepEqual(demoPagesWorkflowFailures(pullRequest, scripts), [
    "Pages workflow must run only for pushes and manual dispatch",
  ]);
  const branches = mutate(
    pagesWorkflow,
    "branches: [main]",
    "branches: [main, dev]",
  );
  assert.deepEqual(demoPagesWorkflowFailures(branches, scripts), [
    "Pages workflow push trigger must target main only",
  ]);
});

test("Pages push paths must keep the demo sources and the workflow itself", () => {
  const failure = [
    "Pages workflow push paths must include apps/web-demo/** and .github/workflows/demo-pages.yml",
  ];
  for (const path of [
    '      - "apps/web-demo/**"\n',
    '      - ".github/workflows/demo-pages.yml"\n',
  ]) {
    const fixture = mutate(pagesWorkflow, path, "");
    assert.deepEqual(demoPagesWorkflowFailures(fixture, scripts), failure);
  }
  const unfiltered = pagesWorkflow.replace(/ {4}paths:\n(?: {6}- .*\n)+/, "");
  assert.notEqual(unfiltered, pagesWorkflow);
  assert.deepEqual(demoPagesWorkflowFailures(unfiltered, scripts), []);
});

test("Pages rejects a build that skips verification or uploads another path", () => {
  const skipped = mutate(pagesWorkflow, "pnpm demo:verify", "pnpm demo:build");
  assert.deepEqual(demoPagesWorkflowFailures(skipped, scripts), [
    "Pages build job must run pnpm demo:verify",
  ]);
  const artifact = mutate(
    pagesWorkflow,
    "path: apps/web-demo/dist",
    "path: apps/windows-client/dist",
  );
  assert.deepEqual(demoPagesWorkflowFailures(artifact, scripts), [
    "Pages build job must upload only the demo dist artifact",
  ]);
});

test("Pages rejects a deploy job that does not need build", () => {
  const fixture = mutate(pagesWorkflow, "    needs: build\n", "");
  assert.deepEqual(demoPagesWorkflowFailures(fixture, scripts), [
    "Pages deploy job must deploy the existing build artifact",
  ]);
});
