# Release status: 0.1.0-alpha.4

Status date: 2026-08-10

## Repository scope

The active repository contains the standalone Tauri 2 Windows client, its React interface, native Rust implementation, source tests, documentation, and candidate-evidence tooling. It does not contain the retired web service or PWA implementation.

## Verified locally

The alpha.4 source implementation is available for local verification in this
dirty shared working tree. No command result is recorded here as alpha.4 release
evidence. Documentation validation is a local source check only; it does not
establish a reproducible clean checkout, a Windows build, an MSI, a signature,
or a managed-tenant result.

## Qualification contract

`APPPORT_QUALIFICATION_PROFILE` is compile-time only and must be `read_only` or
`write_qualification`. `APPPORT_RELUTION_WRITES_ENABLED` must exactly match the
selected profile. Release builds require
`APPPORT_QUALIFICATION_TENANT_APPROVED=true` and
`APPPORT_RELUTION_TENANT_CLASS=qualification`. The write profile also requires
`APPPORT_DISPOSABLE_RESOURCES_APPROVED=true` and an externally supplied,
non-secret qualification plan.

Tokens are supplied only through masked console input. They must never appear in
arguments, environment variables, files, logs, or reports.

## Not qualified

- No clean-checkout source-gate result, approved tenant inputs, Windows MSVC MSI,
  MSI hash, configuration fingerprint, or Windows ACL and Credential Manager
  result has been recorded for alpha.4.
- No `candidateReady=true` evidence has been recorded.
- No live read-only or write-qualification pilot evidence has been recorded; in
  particular, no `pilotQualified=true` result has been recorded.
- Managed-device connection, catalog, icon, inventory, background checks,
  disposable-resource write qualification, and destructive authorization remain
  unrun external gates.
- Signing, publication, production qualification, administrative operations, and
  Relution application uninstall are outside alpha.4 and have no authorization or
  evidence. MSI uninstall is used only to clean up candidate verification.

An alpha.4 MSI is tenant-fixed, unsigned, and non-distributable.
`candidateReady` describes completed candidate build evidence. `pilotQualified`
describes separately completed live qualification under the selected profile; it
must not be inferred from `candidateReady`.

See the [release checklist](docs/RELEASE_CHECKLIST.md), [alpha.4 release notes](docs/releases/0.1.0-alpha.4.md), and [alpha.3 historical release notes](docs/releases/0.1.0-alpha.3.md).
