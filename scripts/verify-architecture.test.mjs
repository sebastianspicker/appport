import assert from "node:assert/strict";
import test from "node:test";

import { rustSourceFailures } from "./verify-architecture.mjs";

const rustRoot = "apps/windows-client/src-tauri/src";

test("accepts imports within the declared native layers", () => {
  assert.deepEqual(
    rustSourceFailures(
      `${rustRoot}/domain/catalog.rs`,
      "use crate::domain::Version;",
    ),
    [],
  );
});

test("rejects glob imports and domain dependencies on outer layers", () => {
  const failures = rustSourceFailures(
    `${rustRoot}/domain/catalog.rs`,
    "use crate::application::*;\nuse reqwest::Client;",
  );
  assert.deepEqual(failures, [
    `${rustRoot}/domain/catalog.rs contains a glob import`,
    `${rustRoot}/domain/catalog.rs crosses the pure domain boundary`,
  ]);
});

test("rejects application workflows inside the Relution adapter", () => {
  const path = `${rustRoot}/infrastructure/relution/catalog.rs`;
  assert.deepEqual(
    rustSourceFailures(
      path,
      "use crate::application::Catalog;\nfn list_apps() {}",
    ),
    [
      `${path} crosses the Relution adapter boundary`,
      `${path} contains an application workflow facade`,
    ],
  );
});

test("rejects infrastructure support types at the native interface", () => {
  const path = `${rustRoot}/interface/commands.rs`;
  assert.deepEqual(
    rustSourceFailures(
      path,
      "fn details() -> Result<support::SupportDetails, Error> { todo!() }",
    ),
    [`${path} exposes an infrastructure support type at the native interface`],
  );
});
