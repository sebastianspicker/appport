# Release status: 0.1.0-alpha.3

Status date: 2026-07-29

## Repository scope

The active repository contains the standalone Tauri 2 Windows client, its React interface, native Rust implementation, source tests, documentation, and candidate-evidence tooling. It does not contain the retired web service or PWA implementation.

## Verified locally

The available host completed these source checks:

- Prettier and documentation validation for 17 maintained Markdown files
- The complete `pnpm verify` gate with Node 26.5.0
- TypeScript checking and the Vite production build
- 27 React tests with 94.04% statement, 81.64% branch, 95.65% function, and 96.28% line coverage
- 30 Rust tests, Rust formatting, Clippy with warnings denied, and Cargo check
- Version parity, standalone-boundary validation, evidence-script syntax, forbidden-marker scanning, and `git diff --check`
- Fail-closed build checks for missing qualification configuration

## Not qualified

- A frozen dependency installation was not completed in the current environment.
- No approved qualification-tenant values were supplied.
- No Windows MSVC MSI, MSI hash, configuration fingerprint, Authenticode result, or Windows ACL and Credential Manager test result has been recorded.
- No managed-device connection, catalog, icon, inventory, background-check, destructive authorization, signing, or production qualification evidence has been recorded.

The repository is prepared to generate unsigned candidate evidence, but `candidateReady=true` has not been established. Any alpha.3 MSI remains read-only, unsigned, tenant-fixed, and non-distributable.

See the [release checklist](docs/RELEASE_CHECKLIST.md) and [alpha.3 release notes](docs/releases/0.1.0-alpha.3.md).
