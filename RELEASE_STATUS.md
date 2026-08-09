# Release status: 0.1.0-alpha.3

Status date: 2026-08-09

## Repository scope

The active repository contains the standalone Tauri 2 Windows client, its React interface, native Rust implementation, source tests, documentation, and candidate-evidence tooling. It does not contain the retired web service or PWA implementation.

## Verified locally

The available macOS host completed the source gate against dirty working tree
`701aa9a0c82aa9339f2e52eb1c578a93336cf261` with Node 26.5.0, pnpm 11.6.0,
rustc 1.96.0, and Cargo 1.96.0. The exact command was
`APPPORT_SOURCE_VERIFICATION=true APPPORT_RELUTION_WRITES_ENABLED=false pnpm verify`.
It completed:

- Prettier and documentation validation for 20 maintained Markdown files
- TypeScript checking and the Vite production build
- 50 React tests with 95.23% statement, 84.61% branch, 97.82% function, and 96.89% line coverage
- 31 native-library tests and one qualification-binary test, Rust formatting, Clippy with warnings denied, and Cargo check
- Version parity, standalone-boundary validation, and `git diff --check`

This is local source-gate evidence for the current dirty tree. It is not a
reproducible clean-checkout, Windows, MSI, signing, or managed-tenant result.

## Not qualified

- A frozen dependency installation was not completed in the current environment.
- No approved qualification-tenant values were supplied.
- No Windows MSVC MSI, MSI hash, configuration fingerprint, Authenticode result, or Windows ACL and Credential Manager test result has been recorded.
- No managed-device connection, catalog, icon, inventory, background-check, destructive authorization, signing, or production qualification evidence has been recorded.

The repository is prepared to generate unsigned candidate evidence, but `candidateReady=true` has not been established. Any alpha.3 MSI remains read-only, unsigned, tenant-fixed, and non-distributable.

See the [release checklist](docs/RELEASE_CHECKLIST.md) and [alpha.3 release notes](docs/releases/0.1.0-alpha.3.md).
