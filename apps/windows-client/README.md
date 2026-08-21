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
supplied non-secret qualification plan. The client accepts its token through a
masked sign-in field; the qualification utility accepts tokens through masked
console input. Tokens are never accepted from arguments, environment variables,
files, logs, or reports.

Normal source and qualification candidate builds set
`APPPORT_RELUTION_DIAGNOSTICS=false` exactly. Setting it to `true` produces a
local troubleshooting artifact only: it is not candidate-ready or
distributable. Its bounded response logs are redacted but may still contain
sensitive tenant response data, so delete them after diagnosis unless an
applicable incident-data policy requires retention.

The client contains a dormant username/password authentication scaffold.
Candidate builds must set `APPPORT_RELUTION_PASSWORD_AUTH_ENABLED=false` and
`APPPORT_RELUTION_PASSWORD_AUTH_CONTRACT=none`. Personal-token authentication
remains the only active method. Password authentication must not be enabled
until Relution provides a versioned, vendor-supported password-to-token API
contract that has passed separate live qualification.

The resulting MSI is tenant-fixed, unsigned, and non-distributable. The
qualification profiles do not authorize uninstall, administrative, production,
signing, or publication operations.

## References

- [Development](../../docs/DEVELOPMENT.md)
- [Native client behavior and MSI build](../../docs/NATIVE_WINDOWS_CLIENT.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Configuration](../../docs/CONFIGURATION.md)
