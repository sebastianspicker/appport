import assert from "node:assert/strict";
import test from "node:test";

import {
  requiredLayoutFailures,
  rustSourceFailures,
} from "./verify-architecture.mjs";

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
      `${path} depends on the application or interface layer`,
      `${path} contains an application workflow facade`,
    ],
  );
});

test("keeps the Relution adapter independent of other adapters", () => {
  const path = `${rustRoot}/infrastructure/relution/mod.rs`;
  assert.deepEqual(
    rustSourceFailures(path, "use crate::infrastructure::journal::Journal;"),
    [`${path} crosses the Relution adapter boundary`],
  );
});

test("rejects infrastructure dependencies on application or interface", () => {
  const path = `${rustRoot}/infrastructure/windows/platform.rs`;
  assert.deepEqual(rustSourceFailures(path, "use crate::interface::wire;"), [
    `${path} depends on the application or interface layer`,
  ]);
  assert.deepEqual(
    rustSourceFailures(
      `${rustRoot}/infrastructure/relution/transport.rs`,
      "use crate::domain::catalog::CatalogEntry;",
    ),
    [],
  );
});

test("rejects Relution DTOs outside the adapter", () => {
  for (const path of [
    `${rustRoot}/application/catalog.rs`,
    `${rustRoot}/qualification/checks.rs`,
  ]) {
    for (const source of [
      "fn entry(value: dto::Catalog) {}",
      "use crate::infrastructure::relution::dto;",
      "use crate::infrastructure::relution::{dto, RelutionClient};",
    ]) {
      assert.deepEqual(rustSourceFailures(path, source), [
        `${path} references Relution DTOs; consume domain values from the adapter`,
      ]);
    }
  }
  assert.deepEqual(
    rustSourceFailures(
      `${rustRoot}/application/catalog.rs`,
      "use crate::infrastructure::relution::RelutionClient;",
    ),
    [],
  );
});

test("rejects application dependencies on the interface layer", () => {
  const path = `${rustRoot}/application/desktop.rs`;
  assert.deepEqual(
    rustSourceFailures(path, "use crate::interface::wire::Payload;"),
    [`${path} depends on the outer interface layer`],
  );
});

test("requires layer directories and contract files, not individual modules", () => {
  const directories = new Set([
    "apps/windows-client/src/app",
    "apps/windows-client/src/catalog",
    "apps/windows-client/src/session",
    "apps/windows-client/src/support",
    "apps/windows-client/src/native-bridge",
    `${rustRoot}/interface`,
    `${rustRoot}/application`,
    `${rustRoot}/domain`,
    `${rustRoot}/infrastructure`,
    `${rustRoot}/qualification`,
  ]);
  const files = new Set([
    "apps/windows-client/native-contract.json",
    "apps/windows-client/wire-fixtures.json",
  ]);
  const kindOf = (path) =>
    directories.has(path) ? "directory" : files.has(path) ? "file" : undefined;
  assert.deepEqual(requiredLayoutFailures(kindOf), []);

  directories.delete(`${rustRoot}/domain`);
  files.delete("apps/windows-client/wire-fixtures.json");
  directories.add("apps/windows-client/wire-fixtures.json");
  assert.deepEqual(requiredLayoutFailures(kindOf), [
    `missing required layer directory ${rustRoot}/domain`,
    "missing required contract file apps/windows-client/wire-fixtures.json",
  ]);
});

const grouped = (...members) =>
  `use crate::{\n${members.map((member) => `    ${member},\n`).join("")}};`;

function assertRule(path, sources, failures) {
  for (const source of sources) {
    assert.deepEqual(rustSourceFailures(path, source), failures, source);
  }
}

test("rejects domain dependencies on outer layers in plain and grouped imports", () => {
  const path = `${rustRoot}/domain/catalog.rs`;
  assertRule(
    path,
    [
      "use crate::application::desktop::DesktopService;",
      "fn f() { crate::infrastructure::logging::write(1); }",
      grouped("domain::device", "application::desktop::DesktopService"),
      grouped(
        "domain::{device, catalog}",
        "infrastructure::{relution::RelutionClient}",
      ),
    ],
    [`${path} crosses the pure domain boundary`],
  );
  assertRule(
    path,
    ["use crate::interface::wire;", grouped("interface::{wire}")],
    [
      `${path} crosses the pure domain boundary`,
      `${path} depends on the outer interface layer`,
    ],
  );
});

test("rejects side-effecting crates and std modules in the domain", () => {
  const path = `${rustRoot}/domain/device.rs`;
  assertRule(
    path,
    [
      "use tauri::Manager;",
      "use reqwest::Client;",
      "fn f() { windows::Win32::Foundation::CloseHandle(h); }",
      "use rusqlite::Connection;",
      "use tokio::sync::Mutex;",
      "use std::fs;",
      "use std::net::IpAddr;",
      "fn f() { std::process::exit(1); }",
      "use std::time::SystemTime;",
      "use std::{collections::HashMap, fs::File};",
      "use std::{\n    net,\n    time::{Duration, SystemTime},\n};",
    ],
    [`${path} crosses the pure domain boundary`],
  );
});

test("accepts pure domain code, comments, and literals that mention outer layers", () => {
  assertRule(
    `${rustRoot}/domain/device.rs`,
    [
      "use std::{cmp::Ordering, collections::HashSet, time::Duration};\nuse serde::Serialize;",
      "//! Never import crate::infrastructure or std::fs here.\nuse crate::domain::catalog;",
      'const NOTE: &str = "crate::application::desktop";',
      'const RAW: &str = r#"use tokio::sync::Mutex;"#;',
      "fn windows_display(value: &str) -> &str { value }",
    ],
    [],
  );
});

test("rejects application dependencies on the interface in grouped imports", () => {
  const path = `${rustRoot}/application/desktop.rs`;
  assertRule(
    path,
    [
      grouped(
        "application::catalog::CatalogService",
        "interface::wire::Payload",
      ),
      "use crate::{domain::catalog, interface::{wire::{Payload}}};",
    ],
    [`${path} depends on the outer interface layer`],
  );
  assert.deepEqual(
    rustSourceFailures(
      path,
      grouped(
        "domain::catalog::CatalogView",
        "infrastructure::{logging, relution}",
      ),
    ),
    [],
  );
});

test("rejects infrastructure dependencies on outer layers in grouped imports", () => {
  const path = `${rustRoot}/infrastructure/windows/support.rs`;
  assertRule(
    path,
    [
      "use crate::{\n    application::desktop::DesktopService,\n};",
      grouped("domain::support::SupportDetails", "interface::wire"),
      "use crate::{error::Error, application::{support::SupportService as Service}};",
    ],
    [`${path} depends on the application or interface layer`],
  );
  assert.deepEqual(
    rustSourceFailures(
      path,
      grouped(
        "domain::support::{SupportBundleResult, SupportDetails}",
        "error::Error",
      ),
    ),
    [],
  );
});

test("rejects interface dependencies on infrastructure in plain and grouped imports", () => {
  const path = `${rustRoot}/interface/commands.rs`;
  assertRule(
    path,
    [
      "use crate::infrastructure::windows::task;",
      "fn f() { crate::infrastructure::windows::platform::current_locale(); }",
      grouped(
        "application::desktop::DesktopService",
        "infrastructure::relution::RelutionConfig",
      ),
      grouped(
        "domain::catalog::CatalogView",
        "infrastructure::{\n        windows::{platform, task},\n    }",
      ),
    ],
    [`${path} depends on infrastructure; call an application service`],
  );
  assert.deepEqual(
    rustSourceFailures(
      path,
      grouped(
        "application::{desktop::{self, DesktopService}}",
        "domain::support",
        "interface::wire",
      ),
    ),
    [],
  );
});

test("rejects grouped Relution DTO imports outside the adapter", () => {
  for (const path of [
    `${rustRoot}/application/catalog.rs`,
    `${rustRoot}/qualification/checks.rs`,
  ]) {
    assertRule(
      path,
      [
        grouped("infrastructure::relution::{dto, RelutionClient}"),
        grouped(
          "error::Error",
          "infrastructure::{\n        relution::dto::Catalog,\n    }",
        ),
      ],
      [
        `${path} references Relution DTOs; consume domain values from the adapter`,
      ],
    );
  }
});

test("keeps the Relution adapter independent of other adapters in grouped imports", () => {
  const path = `${rustRoot}/infrastructure/relution/transport.rs`;
  assertRule(
    path,
    [
      "use crate::infrastructure::{windows::platform};",
      grouped("error::Error", "infrastructure::{journal::ActionJournal}"),
    ],
    [`${path} crosses the Relution adapter boundary`],
  );
});

test("rejects error classification by message text anywhere in the crate", () => {
  for (const path of [
    `${rustRoot}/application/actions.rs`,
    `${rustRoot}/lib.rs`,
    `${rustRoot}/interface/command_tests.rs`,
  ]) {
    assertRule(
      path,
      [
        'fn f(m: &str) -> bool { m.starts_with("offline:") }',
        'fn f(m: String) -> bool { m.contains( "session-expired:") }',
        'fn f(m: &str) -> bool { m.to_string().contains("device_match_failed: x") }',
      ],
      [`${path} classifies errors by message text; match the typed error kind`],
    );
  }
  assertRule(
    `${rustRoot}/application/actions.rs`,
    [
      'fn f(r: &str) -> bool { r.contains("/security/users/baseInfo/query") }',
      "fn f(e: &Error) -> bool { e.kind() == ErrorKind::Offline }",
    ],
    [],
  );
});

test("rejects glob imports inside grouped imports", () => {
  const path = `${rustRoot}/application/catalog.rs`;
  assert.deepEqual(
    rustSourceFailures(path, "use crate::{\n    domain::{catalog::*},\n};"),
    [`${path} contains a glob import`],
  );
});

test("rejects interface use of adapter crates", () => {
  const path = `${rustRoot}/interface/runtime.rs`;
  for (const source of [
    "use windows::Win32::System::Threading::CreateMutexW;",
    "fn f() { rusqlite::Connection::open_in_memory(); }",
    "use reqwest::{Client, Url};",
  ]) {
    assert.deepEqual(rustSourceFailures(path, source), [
      `${path} depends on infrastructure; call an application service`,
    ]);
  }
  assert.deepEqual(rustSourceFailures(path, "use tauri::Manager;"), []);
});
