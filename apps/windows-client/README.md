# Appport Windows client

This package contains the React and Tauri 2 application for managed Windows 11
x64 devices.

React renders the Available, Updates, action, and support interfaces. Rust owns
Relution HTTPS communication, device matching, Credential Manager access,
scheduled checks, notifications, local persistence, and protocol activation.
The WebView has no network access.

The catalog includes only supported Windows applications authorized through
direct or recursive Relution `RELEASE` permissions. Applications that are
already current remain an internal classification; there is no Installed or
Assigned view. The client does not run Winget or installers itself.

The support panel can copy device details, create a consented local ZIP, and
open the fixed `Relution\Appport\SupportBundles` directory under the current
user's local application data. It cannot upload bundles, execute scripts, or
write to a user-selected path.

## Commands

```sh
pnpm --dir apps/windows-client dev
pnpm verify:source
```

The first command starts the Vite-only UI server. It does not compile Rust,
embed release configuration, or contact a tenant. Run
`pnpm --dir apps/windows-client tauri dev` only on a configured Windows host.
Run `pnpm windows:package` on a Windows build host to build the configured MSI.

Alpha.4 supports `read_only` and `write_qualification` compile-time profiles.
Candidate builds require approved qualification-tenant inputs, diagnostics
disabled, and a writes flag that exactly matches the selected profile. The
write profile also requires approved disposable resources and a separately
supplied non-secret qualification plan.

The client accepts personal tokens only through its masked sign-in field. The
qualification utility accepts tokens only through masked console input. Tokens
must not appear in arguments, environment variables, files, logs, or reports.

## References

- [Architecture](../../docs/ARCHITECTURE.md)
- [Configuration](../../docs/CONFIGURATION.md)
- [Development](../../docs/DEVELOPMENT.md)
- [Native client behavior](../../docs/NATIVE_WINDOWS_CLIENT.md)
