# Contributing

Keep changes within the standalone Windows-client boundary. This repository
does not contain browser routes, server routes, or Relution administrative
credentials.

1. Use Node 26.5.x and pnpm 11.6.0.
2. Install dependencies with `pnpm install --frozen-lockfile`.
3. Keep versions aligned across the package manifests, Cargo manifest and
   lockfile, Tauri configuration, and WiX configuration.
4. Run `pnpm verify:source` before requesting review.

Alpha.4 candidate builds require an approved non-secret qualification origin
and UUIDs. Select `APPPORT_QUALIFICATION_PROFILE=read_only` or
`write_qualification`, and set `APPPORT_RELUTION_WRITES_ENABLED` to the matching
value. Never commit tenant credentials or personal tokens.

Place focused React tests beside the feature they exercise and Rust tests in
the Windows-client crate. Local transport mocks may cover decoding, pagination,
retry, permission, inventory, icon, and correlation behavior. Do not add a
production mock mode or present mocked responses as tenant evidence.

Source verification does not prove MSI packaging, Windows Credential Manager or
ACL behavior, code signing, service connectivity, destructive authorization,
or managed-device behavior. Those checks require their respective Windows and
Relution environments.
