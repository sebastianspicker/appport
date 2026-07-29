# Development

Install workspace dependencies with `pnpm install --frozen-lockfile`. Run the client shell with `pnpm --dir apps/windows-client dev`.

The root workspace orchestrates the Windows client only. Its source gate covers the client application, documentation, and candidate-evidence helpers. For source-only checks without qualification inputs, run:

```sh
APPPORT_SOURCE_VERIFICATION=true APPPORT_RELUTION_WRITES_ENABLED=false pnpm verify
```

This mode embeds an invalid test origin that cannot contact a tenant. Release builds reject it.

For a Windows alpha.3 MSI, use a Windows x64 MSVC environment and the approved non-secret qualification-tenant origin, organization UUID, and native application UUID. Set `APPPORT_RELUTION_WRITES_ENABLED=false` before running `pnpm client:tauri`. Release builds reject missing, placeholder, malformed, or credential-bearing values and always embed writes as disabled.

Do not use a production Relution API endpoint for source-only verification. Any alpha.3 MSI is unsigned, tenant-fixed, read-only, and non-distributable. Live authentication, device assignment, notification delivery, and managed-tenant reads need separate evidence. Deployment and administrative operations are outside this alpha.
