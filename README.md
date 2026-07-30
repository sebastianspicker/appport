# Appport

Appport is a pnpm workspace for a standalone Windows client. The product is a Tauri application for managed Windows devices. Runtime behavior stays inside the native application.

The client connects directly to a fixed HTTPS Relution API endpoint. The Windows WebView does not make network requests; native Rust code owns authenticated requests and local credential handling.

## Interface mockup

![Appport application catalog mockup](docs/assets/appport-catalog-mockup.svg)

This mockup illustrates the catalog layout. It does not contain qualification-tenant or managed-device data and is not release evidence.

[Open the static Appport demo](https://sebastianspicker.github.io/appport/). It uses sanitized fixture data, and every command-capable action is visibly simulated.

## Workspace

    apps/windows-client/  Tauri, Rust, React, and Vite client
    docs/                 Product, build, release, and security documentation
    scripts/              Workspace verification and evidence helpers

## Prerequisites

- Node 26.5.x
- pnpm 11.6.0
- Rust stable with Clippy and rustfmt
- Windows 11 x64 with the MSVC toolchain to build an MSI

Install dependencies with `pnpm install --frozen-lockfile`. For source-only verification without tenant configuration, run:

```sh
APPPORT_SOURCE_VERIFICATION=true APPPORT_RELUTION_WRITES_ENABLED=false pnpm verify
```

Run the development shell with `pnpm --dir apps/windows-client dev`.

Alpha.3 is a read-only qualification candidate, not a general distribution. The client requires approved non-secret qualification-tenant configuration embedded at build time: set `APPPORT_RELUTION_API_BASE_URL`, `APPPORT_RELUTION_ORGANIZATION_UUID`, and `APPPORT_NATIVE_APP_UUID`, then set `APPPORT_RELUTION_WRITES_ENABLED=false` before running `pnpm client:tauri`.

The Windows candidate lane requires approved repository variables. When those values are present, it builds a tenant-fixed, unsigned MSI and records candidate evidence. Managed-device validation, destructive authorization, signing, and production qualification remain separate.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Development](docs/DEVELOPMENT.md)
- [Native Windows client](docs/NATIVE_WINDOWS_CLIENT.md)
- [Operations](docs/OPERATIONS.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Current release status](RELEASE_STATUS.md)
- [Security policy](SECURITY.md)
