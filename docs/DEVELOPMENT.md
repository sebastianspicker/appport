# Development

Install workspace dependencies with `pnpm install --frozen-lockfile`.

`pnpm --dir apps/windows-client dev` starts the Vite-only UI development server.
It is useful for UI work but does not compile the native application, embed a
qualification configuration, or contact a tenant. `pnpm --dir apps/windows-client tauri dev`
is the configured Tauri development command and must run only on a suitable
Windows host with the required compile-time inputs.

The root workspace orchestrates the Windows client only. Its source gate covers the client application, documentation, and candidate-evidence helpers. For source-only checks without qualification inputs, run:

```sh
APPPORT_SOURCE_VERIFICATION=true APPPORT_QUALIFICATION_PROFILE=read_only APPPORT_RELUTION_WRITES_ENABLED=false pnpm verify
```

This mode embeds an invalid test origin that cannot contact a tenant. Release builds reject it.

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
Tokens are provided only by masked console input, never arguments, environment
variables, files, logs, or reports. Any alpha.4 MSI is unsigned, tenant-fixed,
and non-distributable. `candidateReady` build evidence and `pilotQualified` live
qualification are separate. Live authentication, device assignment, notification
delivery, managed-tenant reads, and write-profile validation need separate
evidence; state every unrun external gate. Uninstall, administrative, production,
signing, and publication operations are outside this alpha.
