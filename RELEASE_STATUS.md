# Release status: 0.1.0-alpha.1

Status date: 2026-07-24

## Local source evidence

The current host uses Node 26.5.0. The repository requires Node 24.18.x, and
`pnpm verify:toolchain` rejects Node 26 as intended.

The remaining portable stages have been run individually on the available
host:

- ESLint;
- broker and client TypeScript checks;
- 77 broker tests;
- 7 client interface tests;
- client web build;
- Rust formatting and Clippy with warnings denied;
- 15 Rust tests and `cargo check`;
- broker production build;
- documentation link and presentation checks.

This is diagnostic source evidence. It is not a passing `pnpm verify` result
under the pinned Node version.

## Unverified local-candidate gates

- clean-checkout installation with Node 24.18.x;
- a complete `pnpm verify` run;
- coverage thresholds, because no coverage provider is configured;
- Docker image build and non-root container health checks.

## Unverified pilot-ready gates

- trusted HTTPS proxy behavior;
- read-only production secret mounts;
- encrypted backup and restore;
- signed Windows x64 MSI creation;
- managed Windows installation, upgrade, rollback, and uninstall;
- Credential Manager, Task Scheduler, notification, and accessibility checks;
- live Relution read qualification and deployment canaries.

## Unverified pilot-validation gates

- one week of restricted-pilot operation;
- monitored authentication, device matching, action, and `unknown` outcomes;
- live Relution evidence;
- exercised rollback readiness.

## Accepted restricted-pilot risks

Native sessions are portable bearer tokens. Initial Relution user resolution
uses a username claim before the immutable Relution user UUID is pinned. These
risks are acceptable only under the restrictions in
[docs/RUNTIME_CONTRACT.md](docs/RUNTIME_CONTRACT.md).

Promotion requirements are in
[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).
