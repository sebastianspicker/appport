# Development

Install workspace dependencies with `pnpm install --frozen-lockfile`.

`pnpm --dir apps/windows-client dev` starts the Vite-only UI development server.
It is useful for UI work but does not compile the native application, embed a
qualification configuration, or contact a tenant. `pnpm --dir apps/windows-client tauri dev`
is the configured Tauri development command and must run only on a suitable
Windows host with the required compile-time inputs.

The root workspace orchestrates the Windows client only. Its source gate covers the client application, documentation, and candidate-evidence helpers. For source-only checks without qualification inputs, run:

```sh
APPPORT_SOURCE_VERIFICATION=true APPPORT_QUALIFICATION_PROFILE=read_only APPPORT_RELUTION_WRITES_ENABLED=false APPPORT_RELUTION_DIAGNOSTICS=false APPPORT_RELUTION_PASSWORD_AUTH_ENABLED=false APPPORT_RELUTION_PASSWORD_AUTH_CONTRACT=none pnpm verify
```

This mode embeds an invalid test origin that cannot contact a tenant. Release builds reject it.

For a controlled diagnostic Tauri development run on Windows PowerShell, set
every required compile-time input before starting the development command. Use
only the approved non-secret qualification endpoint and UUIDs; do not set a
token in the environment.

```powershell
$env:APPPORT_RELUTION_API_BASE_URL = Read-Host "Approved qualification Relution HTTPS origin"
$env:APPPORT_RELUTION_ORGANIZATION_UUID = Read-Host "Approved organization UUID"
$env:APPPORT_NATIVE_APP_UUID = Read-Host "Approved native application UUID"
$env:APPPORT_QUALIFICATION_PROFILE = "read_only"
$env:APPPORT_RELUTION_WRITES_ENABLED = "false"
$env:APPPORT_QUALIFICATION_TENANT_APPROVED = "true"
$env:APPPORT_RELUTION_TENANT_CLASS = "qualification"
$env:APPPORT_SOURCE_REVISION = (git rev-parse HEAD)
$env:APPPORT_RELUTION_DIAGNOSTICS = "true"
$env:APPPORT_RELUTION_PASSWORD_AUTH_ENABLED = "false"
$env:APPPORT_RELUTION_PASSWORD_AUTH_CONTRACT = "none"
pnpm --dir apps/windows-client tauri dev
```

For `write_qualification`, set `APPPORT_QUALIFICATION_PROFILE` to
`write_qualification`, `APPPORT_RELUTION_WRITES_ENABLED` to `true`, and also
set `APPPORT_DISPOSABLE_RESOURCES_APPROVED=true` with the separately supplied
non-secret qualification plan. The diagnostic flag is compile-time only and
changes the configuration fingerprint, so a diagnostic binary is never
normal-candidate-equivalent.

In any diagnostic-enabled debug-profile native run, including the Tauri
development command above, Appport writes each already sanitized JSON response record to stderr with the
`APPPORT_RELUTION_DIAGNOSTIC` prefix, including icon response metadata. It
prints neither request/response headers, query values, tokens, identifiers, nor
raw response bodies. The stderr sink is compiled out of normal release builds,
which remain file-only and use the Windows GUI subsystem. The same bounded records
are written to `%LOCALAPPDATA%\\Relution\\Appport\\relution-debug.log` and
rotate one `.log.1` file; both files expire at the next diagnostic write after
seven days. Treat the terminal, IDE, and CI capture as sensitive troubleshooting
data just like the files, and remove them after the investigation unless a
documented retention requirement applies.

The password-authentication UI and native command contracts are scaffolding
only. Source verification defaults the capability to disabled, and qualification
builds must set `APPPORT_RELUTION_PASSWORD_AUTH_ENABLED=false` with
`APPPORT_RELUTION_PASSWORD_AUTH_CONTRACT=none`. Enabling either value is a build
error until a supported Relution password-to-token contract is implemented and
qualified. Tests may render the gated UI with mocked capabilities; they must not
send a password to a network endpoint or persistence layer.

For a Windows alpha.4 MSI, use a Windows x64 MSVC environment and the approved
non-secret qualification-tenant origin, organization UUID, and native application
UUID. Select `APPPORT_QUALIFICATION_PROFILE=read_only` or
`write_qualification`; set `APPPORT_RELUTION_WRITES_ENABLED` to the exact
matching value. Release builds also require
`APPPORT_QUALIFICATION_TENANT_APPROVED=true` and
`APPPORT_RELUTION_TENANT_CLASS=qualification`. The write profile requires
`APPPORT_DISPOSABLE_RESOURCES_APPROVED=true` and an externally supplied,
non-secret qualification plan.

The write-plan format is defined by
[`qualification-plan.schema.json`](qualification-plan.schema.json). Run the
candidate-built operator utility with `relution-appport-qualification
--candidate-evidence C:\absolute\path\evidence.json --plan
C:\absolute\path\qualification-plan.json`. Omit `--plan` for the read-only
profile. The utility verifies its embedded configuration fingerprint and source
revision against candidate evidence before prompting for credentials. It copies
the candidate-evidence utility digest into the live report as correlation data;
`alpha:evidence` later rehashes the supplied utility artifact and verifies that
digest when binding the report to the exact MSI and utility. The plan contains only disposable
resource identifiers, expected versions, and cleanup ownership. The utility
prints only their SHA-256 fingerprints.

Do not use a production Relution API endpoint for source-only verification.
The client receives its token through the masked sign-in field; qualification
tokens use masked console input. Tokens are never accepted from arguments,
environment variables, files, logs, or reports. Any alpha.4 MSI is unsigned, tenant-fixed,
and non-distributable. `candidateReady` build evidence and `pilotQualified` live
qualification are separate. Live authentication, device assignment, notification
delivery, managed-tenant reads, and write-profile validation need separate
evidence; state every unrun external gate. Uninstall, administrative, production,
signing, and publication operations are outside this alpha.
