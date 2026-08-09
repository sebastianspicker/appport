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

Run `pnpm --dir apps/windows-client tauri dev` or `pnpm client:tauri` only on a
configured Windows development or build host.

## References

- [Development](../../docs/DEVELOPMENT.md)
- [Native client behavior and MSI build](../../docs/NATIVE_WINDOWS_CLIENT.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Configuration](../../docs/CONFIGURATION.md)
