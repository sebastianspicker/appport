# Building and qualifying alpha.4

Version `0.1.0-alpha.4` is built and tested against one dedicated Relution
qualification tenant. Its MSI is unsigned and cannot be distributed as a production
installer. The [release status](../RELEASE_STATUS.md) tracks the remaining work.

Live tenant access and deployment tests require approval from the tenant operator.
The tests use ordinary Relution users and managed devices in that tenant, so arrange
the users, assignments, and any disposable resources before starting. Personal
tokens are entered only when the desktop client or qualification utility prompts for
them. They must stay out of arguments, environment variables, files, logs, and
reports; see [Personal tokens](CONFIGURATION.md#personal-tokens).

## Build the Windows candidate

Use a clean checkout on Windows 11 x64 with Node.js 26.5.x, pnpm 11.6.0, Rust 1.96.0,
and the MSVC toolchain. Confirm that the release version is `0.1.0-alpha.4` in the
root package, desktop package, Cargo files, and Tauri configuration. The WiX version
is `0.1.0.4`.

Set the values described in [Configuration](CONFIGURATION.md). Choose one profile:

- `read_only` with `APPPORT_RELUTION_WRITES_ENABLED=false`
- `write_qualification` with `APPPORT_RELUTION_WRITES_ENABLED=true` and
  `APPPORT_DISPOSABLE_RESOURCES_APPROVED=true`

Both profiles require `APPPORT_QUALIFICATION_TENANT_APPROVED=true`,
`APPPORT_RELUTION_TENANT_CLASS=qualification`, the exact source revision, and
`APPPORT_RELUTION_DIAGNOSTICS=false`.

Install dependencies and run the complete source check:

```powershell
pnpm install --frozen-lockfile
pnpm verify:source
```

Build the MSI and qualification utility from that same checkout and configuration:

```powershell
pnpm windows:package -- --target x86_64-pc-windows-msvc
cargo build --manifest-path apps/windows-client/src-tauri/Cargo.toml `
  --release --target x86_64-pc-windows-msvc `
  --bin relution-appport-qualification
```

Keep the MSI and executable together. Install the MSI, run the installed
`Appport.exe --qualification-self-check`, save its JSON output, confirm that the
self-check cleaned up its temporary state, and uninstall the MSI.

From the repository root, inspect and bind the resulting files:

```powershell
pnpm alpha:evidence -- --msi C:\absolute\path\Appport.msi `
  --qualification-utility C:\absolute\path\relution-appport-qualification.exe `
  --windows-self-check C:\absolute\path\windows-self-check.json
```

This command reruns the source checks, validates the embedded configuration, hashes
the MSI and qualification utility, checks their file formats and the MSI signature
state, verifies the installed self-check, and scans UTF-8 and UTF-16 strings for
credential markers.

The generated `evidence.json` is candidate-ready only when it records all of the
following:

- `candidateReady=true`
- `signed=false`
- `distributable=false`
- `diagnosticsEnabled=false`
- the expected source revision and configuration fingerprint
- the SHA-256 digests of the MSI and qualification utility

The command rejects a dirty source tree and cannot mark a candidate ready without
the Windows self-check.

## Test the candidate against Relution

Run the qualification utility produced with the candidate, give it that candidate's
`evidence.json`, and save the JSON written to stdout:

```powershell
relution-appport-qualification.exe `
  --candidate-evidence C:\absolute\path\evidence.json `
  > C:\absolute\path\live-report.json
```

The `read_only` profile checks authentication, device matching, permissions,
catalog reads, and expected denials without deploying software.

For `write_qualification`, add a plan that conforms to
[`qualification-plan.schema.json`](qualification-plan.schema.json):

```powershell
relution-appport-qualification.exe `
  --candidate-evidence C:\absolute\path\evidence.json `
  --plan C:\absolute\path\qualification-plan.json `
  > C:\absolute\path\live-report.json
```

The plan names the disposable applications, packages, device, expected versions,
and cleanup responsibility for the run. The utility records only SHA-256 fingerprints
for these identifiers. It exercises the same catalog and action services as the
desktop application. After a write run, restore the disposable resources and create
the separate cleanup report identified by the plan.

Bind the live result to the same candidate by running `pnpm alpha:evidence` again
with the original MSI, qualification utility, and Windows self-check, plus
`--live-report`. A write-profile run also requires `--cleanup-report`:

```powershell
pnpm alpha:evidence -- --msi C:\absolute\path\Appport.msi `
  --qualification-utility C:\absolute\path\relution-appport-qualification.exe `
  --windows-self-check C:\absolute\path\windows-self-check.json `
  --live-report C:\absolute\path\live-report.json `
  --cleanup-report C:\absolute\path\cleanup-report.json
```

Omit `--cleanup-report` for `read_only`. The command checks that every report refers
to the candidate MSI, qualification utility digest, configuration fingerprint, and
source revision. A completed candidate build has `candidateReady=true`.
`pilotQualified=true` appears only after the selected live profile succeeds and,
for the write profile, cleanup is confirmed. Note any Windows or Relution check that
was skipped.

The qualification profiles do not include Relution application uninstall,
administrative tasks, production-tenant use, code signing, publication, or general
distribution.

## Handle diagnostic and user data

A diagnostic build uses a different configuration fingerprint and is unsuitable for
candidate testing. Its sanitized response logs can still reveal tenant details.
Remove `relution-debug.log`, `relution-debug.log.1`, and captured stderr when the
investigation is complete, subject to any incident-retention requirement. See
[Configuration](CONFIGURATION.md) for the fields and size limits.

Signing out removes the Credential Manager record, scheduled-check state, and
notification state from the computer. It does not revoke the personal token in
Relution. Support bundles remain in Appport's fixed current-user support directory
until the user or operator deletes them; Appport never uploads them.

## Deploy the browser demo

The `Demo Pages` workflow runs `pnpm demo:verify`, uploads
`apps/web-demo/dist`, and deploys that directory to GitHub Pages. The artifact check
rejects network access, credentials, persistence, native commands, source maps,
symlinks, and invalid asset paths. This workflow publishes only the synthetic demo
and has no role in qualifying the Windows application. See the demo
[GitHub Pages instructions](../apps/web-demo/README.md#github-pages) for repository
setup.
