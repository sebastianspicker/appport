# Appport Windows client

The Windows client lets users browse software available to their managed PC and
request installs or updates through Relution. It targets Windows 11 x64 and uses
React for the interface and Tauri 2 with Rust for native features.

This package also builds `relution-appport-qualification`, a separate command-line
tool for testing the same application services against an approved Relution tenant.

## Run and test

Run these commands from the repository root:

| Task | Command |
| --- | --- |
| Preview the React interface | `pnpm --dir apps/windows-client dev` |
| Check frontend types | `pnpm frontend:check` |
| Run frontend tests | `pnpm frontend:test` |
| Build the frontend | `pnpm frontend:build` |
| Run Rust tests | `pnpm rust:test` |
| Run the full source checks | `pnpm verify:source` |

The React preview runs without Rust and cannot sign in or contact Relution. To run
the native application on Windows, configure the build inputs first, then run
`pnpm --dir apps/windows-client tauri dev`. Build its MSI with
`pnpm windows:package` on a Windows x64 host with the MSVC toolchain.

See [Development](../../docs/DEVELOPMENT.md) for toolchain versions and setup, and
[Configuration](../../docs/CONFIGURATION.md) for the Relution build inputs.

## How it works

Users sign in with a personal token. Relution supplies their identity, assigned
device, permissions, software inventory, and deployment state. Available lists
software the user can install; Updates lists newer versions for installed software.
Applications already at the current version stay out of the catalog.

Rust handles HTTPS requests, device matching, permissions, Credential Manager,
scheduled checks, notifications, the action journal, and protocol activation. The
WebView has no network access. Relution handles deployment, so Appport does not run
installers itself.

Alpha.4 builds use either the `read_only` or `write_qualification` profile, with a
matching write flag. The write profile requires approved disposable resources and
a separate test plan. Each build is fixed to one qualification tenant and remains
unsigned and unavailable for distribution.

[Architecture](../../docs/ARCHITECTURE.md) describes the code and request flow.
[Operations](../../docs/OPERATIONS.md) covers Windows builds and live testing.
