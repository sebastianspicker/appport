# Contributing

Keep changes within the standalone Windows-client boundary. This repository does not contain browser routes, server routes, or Relution administrative credentials.

1. Use Node 26.5.x and pnpm 11.6.0.
2. Run pnpm install --frozen-lockfile.
3. Keep version values aligned across both package manifests, Cargo manifest and lockfile, Tauri configuration, and WiX configuration.
4. For alpha.3 candidate builds, use approved non-secret qualification-tenant origin and UUIDs, keep the HTTPS origin fixed, and leave `APPPORT_RELUTION_WRITES_ENABLED=false`.
5. Run `APPPORT_SOURCE_VERIFICATION=true APPPORT_RELUTION_WRITES_ENABLED=false pnpm verify` before requesting review when qualification values are unavailable.

Place React tests beside the client source and Rust tests in the Windows-client crate. Local transport mocks may verify decoding, pagination, retry, permission, inventory, icon, and correlation behavior. Do not add a production mock mode or represent mocked responses as tenant evidence.

Windows MSI creation, Windows Credential Manager behavior, code signing, service connectivity, destructive authorization, and managed-device testing require their respective environments. Alpha.3 evidence must retain those external gates as unqualified until separately authorized and performed.
