# Appport Windows client

This workspace contains the React and Tauri 2 client for managed Windows 11 x64
devices.

React renders the Available, Updates, and action interface. Rust owns Relution HTTPS,
device evidence, Credential Manager access, scheduled checks,
notifications, protocol activation, and local logs.

Background notifications compare authorized application-version keys stored in
the HKCU value `UpdateNotificationKeys`. Sign-out deletes local state and reports
whether personal token revocation is still required in Relution.

The client calls the configured Relution API. It does not expose installed
inventory, run Winget, or execute installers.

## Commands

```sh
pnpm --dir apps/windows-client dev
pnpm client:typecheck
pnpm client:test
pnpm client:test:coverage
pnpm client:build
pnpm client:rust:fmt
pnpm client:rust:clippy
pnpm client:rust:test
pnpm client:rust:check
```

`pnpm --dir apps/windows-client dev` is the Vite-only UI server. It does not
compile Rust, embed release configuration, or contact a tenant. Run
`pnpm --dir apps/windows-client tauri dev` only on a configured Windows
development host. `pnpm client:tauri` builds the configured Tauri MSI lane on a
Windows build host.

For alpha.4, compile with `APPPORT_QUALIFICATION_PROFILE=read_only` or
`write_qualification`; `APPPORT_RELUTION_WRITES_ENABLED` must exactly match the
profile. Release builds require approved qualification-tenant signals. The write
profile additionally requires approved disposable resources and an externally
supplied non-secret qualification plan. Tokens are accepted only from masked
console input, never from arguments, environment variables, files, logs, or
reports.

The resulting MSI is tenant-fixed, unsigned, and non-distributable. The
qualification profiles do not authorize uninstall, administrative, production,
signing, or publication operations.

## References

- [Development](../../docs/DEVELOPMENT.md)
- [Native client behavior and MSI build](../../docs/NATIVE_WINDOWS_CLIENT.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Configuration](../../docs/CONFIGURATION.md)
