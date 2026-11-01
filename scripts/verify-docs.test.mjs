import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { documentationLinkFailures } from "./documentation-links.mjs";

import {
  documentedPnpmScripts,
  missingPnpmScripts,
  trackedMarkdownFiles,
} from "./verify-docs.mjs";

test("extracts root and package-scoped pnpm scripts", () => {
  assert.deepEqual(
    documentedPnpmScripts(
      "Run `pnpm verify:source` and `pnpm --dir apps/web-demo run test`.",
    ),
    [
      { directory: undefined, script: "verify:source" },
      { directory: "apps/web-demo", script: "test" },
    ],
  );
});

test("reports missing root and package-scoped scripts", () => {
  const commands = documentedPnpmScripts(
    "Run `pnpm missing` and `pnpm --dir apps/web-demo absent`.",
  );
  assert.deepEqual(
    missingPnpmScripts(commands, { scripts: {} }, () => ({ scripts: {} })),
    [
      "references missing package script missing",
      "references missing package script absent in apps/web-demo",
    ],
  );
});

test("rejects broken files, anchors, and escaped documentation references", () => {
  const root = mkdtempSync(join(tmpdir(), "appport-doc-links-"));
  try {
    const page = join(root, "README.md");
    const contents = [
      "# Existing heading",
      "[valid](#existing-heading)",
      "[missing file](missing.md)",
      "[missing heading](#absent)",
      "[outside](../outside.md)",
      "[external](https://example.test/)",
    ].join("\n");
    writeFileSync(page, contents);
    assert.deepEqual(
      documentationLinkFailures(root, page, new Map([[page, contents]])),
      [
        "README.md links to missing missing.md",
        "README.md links to missing anchor #absent in README.md",
        "README.md links outside the repository",
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("public documentation discovery excludes ignored and untracked local records", () => {
  const root = mkdtempSync(join(tmpdir(), "appport-public-docs-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, ".gitignore"), "ALPHA_AUDIT_LEDGER.md\n");
    writeFileSync(join(root, "README.md"), "# Public documentation\n");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    writeFileSync(
      join(root, "ALPHA_AUDIT_LEDGER.md"),
      "Internal `pnpm gone`\n",
    );
    writeFileSync(join(root, "private-draft.md"), "Internal working draft\n");
    assert.deepEqual(trackedMarkdownFiles(root), [join(root, "README.md")]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
