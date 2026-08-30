# Operations

Operational ownership is split as follows:

| Area                                                  | Owner                   |
| ----------------------------------------------------- | ----------------------- |
| Windows MSI build and signing                         | Appport release process |
| Fixed Relution API endpoint                           | Relution operator       |
| Authentication, authorization, audit, and deployments | Relution operator       |
| Managed-device deployment and inventory               | Relution operator       |

Build the client MSI on Windows with the MSVC toolchain. Supply the approved
non-secret fixed qualification-tenant origin, organization UUID, and native
application UUID. Compile one `APPPORT_QUALIFICATION_PROFILE`:
`read_only` or `write_qualification`. `APPPORT_RELUTION_WRITES_ENABLED` must
exactly match it. Release builds also require
`APPPORT_QUALIFICATION_TENANT_APPROVED=true` and
`APPPORT_RELUTION_TENANT_CLASS=qualification`. Write qualification additionally
requires `APPPORT_DISPOSABLE_RESOURCES_APPROVED=true` and an externally supplied,
non-secret qualification plan.

Normal source and qualification candidate builds must set
`APPPORT_RELUTION_DIAGNOSTICS=false` exactly. Setting it to `true` creates a
local troubleshooting artifact, not a candidate-ready or distributable build.
The bounded response logs are redacted but can still contain sensitive tenant
response data. Delete them after diagnosis unless the applicable incident-data
policy requires retention.

The client supports personal-token sign-in only.

Install the MSI on the Windows build host, run `Appport.exe
--qualification-self-check`, capture its JSON output, and uninstall the MSI.
Then run `pnpm alpha:evidence -- --msi C:\absolute\path\Appport.msi
--qualification-utility C:\absolute\path\relution-appport-qualification.exe
--windows-self-check C:\absolute\path\windows-self-check.json`. The evidence
command reruns source gates, validates and fingerprints the build inputs, hashes
the MSI and candidate-built operator utility, checks their formats and the MSI
signature state, and scans UTF-8
and UTF-16 strings for forbidden credential markers. This packaging uninstall
is part of candidate verification; Appport does not expose a Relution application
uninstall action.

Do not infer Relution availability from a client source gate. `candidateReady`
records completed candidate build evidence; `pilotQualified` is a distinct record
of completed live qualification under the selected profile. Record every unrun
external gate explicitly. Client tokens use the masked sign-in field and
qualification tokens use masked console input; tokens must not appear in
arguments, environment variables, files, logs, or reports. The unsigned,
tenant-fixed artifact is non-distributable. Uninstall, administrative,
production, signing, and publication operations are outside alpha.4.
