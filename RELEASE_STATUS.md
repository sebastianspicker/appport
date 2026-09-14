# Release status: 0.1.0-alpha.4

Appport is an alpha for testing on managed Windows devices. It is not ready for
production or distribution. The repository includes the desktop application, a
command-line qualification utility, build and test tools, and a browser demo with
fictional data.

## What the repository checks

`pnpm verify:source` checks the desktop frontend, portable Rust code, documentation,
architecture, and build-verification tools. `pnpm demo:verify` checks the browser
demo separately. Passing these commands is useful local validation, but it does
not establish that an MSI installs correctly or that the client works with a live
Relution tenant.

The project has no license yet. Licensing and third-party attribution need to be
settled before distribution.

## What a candidate build needs

Each alpha.4 MSI targets one approved Relution qualification tenant. Its build
profile is either `read_only` or `write_qualification`, and the embedded write flag
must match that choice. The write profile also requires approved disposable
resources and a separate plan describing the test.

The evidence tools tie the MSI, qualification utility, installed-runtime self-check,
build configuration, and source revision together. A valid candidate records:

```text
candidateReady=true
signed=false
distributable=false
diagnosticsEnabled=false
```

These values describe a test candidate, not a release. The
[operations guide](docs/OPERATIONS.md) explains how to build it and collect the
required results.

## What still needs verification

No reports establishing `candidateReady` or `pilotQualified` are committed to this
repository. Windows and live-tenant testing still need to establish:

- MSI installation and Windows Credential Manager, access controls, scheduled
  tasks, notifications, and protocol handling;
- live sign-in, exact device matching, catalog and icon loading, inventory,
  recursive group permissions, and background checks;
- deployment requests against approved disposable resources, including permission
  checks and cleanup.

`pilotQualified=true` requires a separate approved live test whose reports match
the candidate. It cannot be inferred from source tests or `candidateReady=true`.
MSI removal is part of test cleanup; uninstalling applications through Relution is
outside the alpha's scope. Administrative operations and production use are also
outside that scope. Signing and publication remain separate release work.

See the [alpha.4 release notes](docs/releases/0.1.0-alpha.4.md) for the profile and
reporting changes in this version.
