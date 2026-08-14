# Appport

Appport is a pnpm workspace for a standalone Windows client. The product is a Tauri application for managed Windows devices. Runtime behavior stays inside the native application.

The client connects directly to a fixed HTTPS Relution API endpoint. The Windows WebView does not make network requests; native Rust code owns authenticated requests and local credential handling.

## Interface mockup

![Appport application catalog mockup](docs/assets/appport-catalog-mockup.svg)

This mockup illustrates the catalog layout. It does not contain qualification-tenant or managed-device data and is not release evidence.

## Workspace

    apps/windows-client/  Tauri, Rust, React, and Vite client
    docs/                 Product, build, release, and security documentation
    scripts/              Workspace verification and evidence helpers

## Prerequisites

- Node 26.5.x
- pnpm 11.6.0
- Rust stable with Clippy and rustfmt
- Windows 11 x64 with the MSVC toolchain to build an MSI

Install dependencies with `pnpm install --frozen-lockfile`. For source-only
verification without tenant configuration, run:

```sh
APPPORT_SOURCE_VERIFICATION=true APPPORT_QUALIFICATION_PROFILE=read_only APPPORT_RELUTION_WRITES_ENABLED=false pnpm verify
```

`pnpm --dir apps/windows-client dev` starts only the Vite UI development
server. It does not compile the native client, embed a qualification
configuration, or contact a tenant. Use `pnpm --dir apps/windows-client tauri dev`
only on a configured Windows development host; it compiles and starts the Tauri
client with its compile-time configuration.

Alpha.4 is a two-stage full-function qualification candidate, not a general
distribution. Select its compile-time `APPPORT_QUALIFICATION_PROFILE` as either
`read_only` or `write_qualification`; `APPPORT_RELUTION_WRITES_ENABLED` must
exactly match that profile. Release builds also require
`APPPORT_QUALIFICATION_TENANT_APPROVED=true` and
`APPPORT_RELUTION_TENANT_CLASS=qualification`. The write profile additionally
requires `APPPORT_DISPOSABLE_RESOURCES_APPROVED=true` and an externally supplied,
non-secret qualification plan.

The Windows candidate lane requires approved non-secret fixed tenant inputs. It
builds a tenant-fixed, unsigned MSI and can record candidate evidence, but it is
non-distributable. `candidateReady` is build-and-evidence status;
`pilotQualified` is separate live-qualification status. Any unrun external gate
must remain explicit. Alpha.4 does not authorize uninstall, administrative,
production, signing, or publication operations.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Development](docs/DEVELOPMENT.md)
- [Native Windows client](docs/NATIVE_WINDOWS_CLIENT.md)
- [Operations](docs/OPERATIONS.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Current release status](RELEASE_STATUS.md)
- [Alpha.4 release notes](docs/releases/0.1.0-alpha.4.md)
- [Security policy](SECURITY.md)
