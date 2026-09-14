import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  checkSourceSizes,
  isExcluded,
  maximumPhysicalLines,
  physicalLineCount,
  sourceFiles,
} from "./check-source-size.mjs";

test("counts physical lines across LF, CRLF, and unterminated files", () => {
  assert.equal(physicalLineCount(""), 0);
  assert.equal(physicalLineCount("one"), 1);
  assert.equal(physicalLineCount("one\ntwo\n"), 2);
  assert.equal(physicalLineCount("one\r\ntwo\r\n"), 2);
  assert.equal(physicalLineCount("one\rtwo"), 2);
});

test("includes tests and reports only files over the physical-line limit", () => {
  withFixture((root) => {
    write(root, "src/within-limit.test.ts", lines(maximumPhysicalLines));
    write(root, "src/over-limit.rs", lines(maximumPhysicalLines + 1));

    assert.deepEqual(
      sourceFiles(root, ["src"]).map(
        (path) => path.endsWith(".test.ts") || path.endsWith(".rs"),
      ),
      [true, true],
    );
    assert.deepEqual(checkSourceSizes(root, ["src"]), [
      {
        lines: maximumPhysicalLines + 1,
        path: "src/over-limit.rs",
      },
    ]);
  });
});

test("includes every configured source extension, including test files", () => {
  withFixture((root) => {
    for (const name of [
      "module.rs",
      "component.ts",
      "component.test.tsx",
      "tool.mjs",
      "styles.css",
    ]) {
      write(root, `src/${name}`, "line");
    }
    write(root, "src/ignored.js", "line");

    assert.deepEqual(
      sourceFiles(root, ["src"])
        .map((path) => basename(path))
        .sort(),
      [
        "component.test.tsx",
        "component.ts",
        "module.rs",
        "styles.css",
        "tool.mjs",
      ],
    );
  });
});

test("excludes generated, archive, local, worktree, index, and design-preview paths", () => {
  withFixture((root) => {
    for (const directory of [
      "archive",
      "generated",
      ".local",
      ".worktrees",
      "index",
      "design-preview",
    ]) {
      write(
        root,
        `${directory}/too-large.tsx`,
        lines(maximumPhysicalLines + 1),
      );
    }

    assert.equal(checkSourceSizes(root, ["."]).length, 0);
  });
  assert.equal(isExcluded("active/index/file.ts"), true);
  assert.equal(isExcluded("active/index.ts"), false);
});

function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "appport-source-size-"));
  try {
    callback(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function write(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

function lines(count) {
  return Array.from({ length: count }, () => "line").join("\n");
}
