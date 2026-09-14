import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { demoArtifactFailures } from "./verify-demo-artifact.mjs";

test("accepts an isolated relative demo artifact", (context) => {
  withFixture(context, (root) => {
    assert.deepEqual(demoArtifactFailures(root), []);
  });
});

test("rejects network code, external assets, and weakened CSPs", (context) => {
  withFixture(context, (root) => {
    write(
      root,
      "apps/web-demo/dist/index.html",
      '<meta http-equiv="Content-Security-Policy" content="connect-src \'self\'">' +
        '<body data-demo-build="appport-synthetic-demo"><script src="https://example.test/app.js"></script></body>',
    );
    write(root, "apps/web-demo/dist/app.js", "fetch('/catalog');");
    write(root, "apps/windows-client/src-tauri/tauri.conf.json", "{}");

    const failures = demoArtifactFailures(root);
    assert.ok(failures.some((failure) => failure.includes("Fetch API call")));
    assert.ok(failures.includes("demo CSP does not disable connections"));
    assert.ok(
      failures.includes(
        "index.html contains non-relative asset https://example.test/app.js",
      ),
    );
    assert.ok(
      failures.includes("production Tauri CSP no longer disables connections"),
    );
  });
});

test("reports a missing demo build directory", (context) => {
  withFixture(context, (root) => {
    rmSync(join(root, "apps/web-demo/dist"), { recursive: true });
    assert.deepEqual(demoArtifactFailures(root), [
      "apps/web-demo/dist is missing",
    ]);
  });
});

test("rejects missing entry HTML, source maps, and native snapshot commands", (context) => {
  withFixture(context, (root) => {
    rmSync(join(root, "apps/web-demo/dist/index.html"));
    write(root, "apps/web-demo/dist/app.js.map", "{}");
    write(root, "apps/web-demo/dist/app.js", "invoke('load_catalog');");
    const failures = demoArtifactFailures(root);
    assert.ok(failures.includes("apps/web-demo/dist/index.html is missing"));
    assert.ok(failures.some((failure) => failure.endsWith("is a source map")));
    assert.ok(
      failures.some((failure) =>
        failure.endsWith("contains native command name"),
      ),
    );
  });
});

function withFixture(context, callback) {
  const root = mkdtempSync(join(tmpdir(), "appport-artifact-"));
  context.after(() => rmSync(root, { force: true, recursive: true }));
  write(
    root,
    "apps/web-demo/dist/index.html",
    '<meta http-equiv="Content-Security-Policy" content="connect-src \'none\'">' +
      '<body data-demo-build="appport-synthetic-demo"><script src="./app.js"></script></body>',
  );
  write(root, "apps/web-demo/dist/app.js", "console.log('demo');");
  write(
    root,
    "apps/windows-client/src-tauri/tauri.conf.json",
    "connect-src 'none'",
  );
  callback(root);
}

function write(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}
