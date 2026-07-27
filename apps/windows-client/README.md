# Appport Windows client

This workspace contains the React and Tauri 2 client for managed Windows 11 x64
devices.

React renders the catalog and action interface. Rust owns broker HTTPS,
browser sign-in, device evidence, Credential Manager access, scheduled checks,
notifications, protocol activation, and local logs.

The client calls the broker under `/api/native/*`. It does not call Relution,
run Winget, or execute installers.

## Commands

```sh
pnpm --dir apps/windows-client dev
pnpm client:typecheck
pnpm client:test
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
- [HTTP API](../../docs/HTTP_API.md)
- [Configuration](../../docs/CONFIGURATION.md)
