# Appport

Appport is a self-service application catalog for managed Windows devices.
It consists of a Windows client and a central broker. The broker authenticates
users, binds each native session to an assigned device, reads approved
applications from Relution, and submits installation or update requests.
Relution remains the system of record and the Relution Windows Agent performs
the software deployment.

## Purpose and scope

Appport provides a restricted interface to applications already released and
authorized in Relution. It does not replace Relution, run package managers, or
execute installers from the client.

The repository contains:

- a React and Tauri 2 Windows client;
- a Next.js broker with SQLite persistence;
- a live Relution management API adapter and a deterministic mock adapter;
- shared TypeScript contracts;
- verification and operational scripts.

## Implemented in source

The list below describes the current source tree. Windows, container, and live
Relution behavior still requires the platform checks listed in
[RELEASE_STATUS.md](RELEASE_STATUS.md).

- Browser-based OIDC sign-in initiated by the Windows client.
- Verifier-bound handoff from the system browser to a loopback callback.
- Device matching by EntDMID, SMBIOS UUID, or serial number plus hostname.
- Catalog, update, and installed-application views for the assigned device.
- Winget, Windows MSI, and Windows EXE application support.
- Install and update requests with confirmation and idempotency controls.
- Action tracking with explicit `unknown` handling when dispatch cannot be
  confirmed.
- Native session storage in Windows Credential Manager.
- Scheduled update checks and English or German Windows notifications.
- Emergency native-session revocation by user, device, or entire database.

## Current limitations

- The native client targets managed Windows 11 x64 devices.
- The browser surface handles sign-in only. It does not provide a software
  catalog.
- The broker supports one process and one SQLite database. Multiple replicas
  and shared SQLite storage are unsupported.
- Live deployment requests are disabled unless
  `APPPORT_LIVE_WRITES_ENABLED=true`.
- The native session is a portable bearer token. Initial Relution user
  resolution depends on a username claim before the immutable Relution user
  UUID is pinned.
- The client has no built-in updater. Relution distributes client updates.
- Signed MSI creation, Windows installation behavior, live Relution canaries,
  backup restoration, and pilot operation are release gates, not verified
  repository capabilities.
- No CI workflow or coverage threshold is included in this source tree.

See [RELEASE_STATUS.md](RELEASE_STATUS.md) for the current evidence boundary.

## Requirements

For installation, local development, and portable checks:

- Node.js 24.18.x;
- pnpm 11.6.0 through Corepack;
- Rust stable for the Tauri core checks.

For a Windows MSI build and device validation:

- Windows 11 x64;
- the Rust MSVC toolchain;
- the WiX prerequisites required by Tauri;
- Evergreen WebView2 on the target device.

The Node and pnpm versions are pinned in [.node-version](.node-version) and
[package.json](package.json).

## Installation

```sh
corepack enable
pnpm install --frozen-lockfile
```

The lockfile covers the broker, shared contracts, and Windows client
workspaces. Do not place credentials or tenant data in an environment file.

## Configuration

The local broker can run with the mock authentication and Relution adapters:

```sh
export AUTH_MODE=mock
export AUTH_SECRET='replace-with-a-long-random-development-value'
export RELUTION_GATEWAY_MODE=mock
pnpm dev
```

Open `http://localhost:3000`. The page confirms that the broker is running but
does not expose the application catalog.

Production uses OIDC, the live Relution adapter, file-mounted secrets, a fixed
HTTPS public origin, and an absolute SQLite path. The complete variable
reference is in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Usage

The installed Windows client follows this flow:

1. Start Appport and select Sign in.
2. Complete authentication in the system browser.
3. Confirm the assigned device shown by the client.
4. Select Apps, Updates, or Installed.
5. Search or filter the available applications.
6. Review and confirm an install or update request.
7. Leave an action in `unknown` state unchanged until an operator reconciles
   it with Relution and installed inventory.

The browser handoff and native API are described in
[docs/HTTP_API.md](docs/HTTP_API.md). Windows-specific behavior is documented
in [docs/NATIVE_WINDOWS_CLIENT.md](docs/NATIVE_WINDOWS_CLIENT.md).

## Repository structure

```text
apps/windows-client/             React and Tauri Windows client
apps/windows-client/src-tauri/   Rust client, Windows integration, MSI config
packages/appport-contracts/      Shared TypeScript API contracts
scripts/                         Toolchain, evidence, and revocation utilities
src/app/                         Next.js pages and route handlers
src/components/                  Broker browser UI components
src/domain/                      Shared broker model exports
src/server/auth/                 Mock and OIDC authentication
src/server/native/               Native handoff, sessions, and device matching
src/server/persistence/          SQLite repository and embedded migrations
src/server/relution/             Mock and live Relution adapters
docs/                            Technical and operational documentation
```

## Development workflow

Run the broker:

```sh
pnpm dev
```

Run the client interface in a browser:

```sh
pnpm --dir apps/windows-client dev
```

The Vite view is useful for interface work, but Tauri commands require the
native shell. A full native sign-in flow also requires a trusted HTTPS broker
origin. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Testing

Run the repository source gate with Node 24.18.x:

```sh
pnpm verify
```

The gate checks the pinned Node version, ESLint, broker and client TypeScript,
broker and client tests, the client web build, Rust formatting, Clippy, Rust
tests, `cargo check`, and the broker production build.

Focused commands and platform boundaries are listed in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Deployment and operation

The broker image is defined by [Dockerfile](Dockerfile). It runs the standalone
Next.js server as UID 1001, stores SQLite data under `/data`, exposes port
`3000`, and uses `/api/ready` as its container health check.

A deployment must provide:

- one broker replica;
- durable storage mounted at `/data`;
- a trusted HTTPS reverse proxy;
- read-only authentication, OIDC, and Relution secret files;
- the production variables in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Deployment, backup, session revocation, and action reconciliation procedures
are in [docs/OPERATIONS.md](docs/OPERATIONS.md). Mandatory production
invariants are in [docs/RUNTIME_CONTRACT.md](docs/RUNTIME_CONTRACT.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `pnpm verify` rejects Node | Select Node 24.18.x from `.node-version` |
| `/api/ready` returns `503` | Required variables, secret file modes, SQLite path, and writable storage |
| The browser shows no catalog | Use the Windows client; the browser is a sign-in surface only |
| Tauri commands fail in Vite | Run the native Tauri shell on Windows |
| Native sign-in cannot connect | HTTPS broker origin, certificate trust, proxy reachability, and system clock |
| An action is `unknown` | Reconcile it with Relution and inventory; do not submit it again |

Additional operational checks are in the
[troubleshooting section](docs/OPERATIONS.md#troubleshooting).

## Security considerations

- Do not commit secrets, signing material, tenant exports, production
  databases, backups, or production logs.
- Production secrets must come from read-only files.
- The Windows WebView cannot make network requests. Rust owns broker access.
- The client contains no Relution service token, OIDC client secret, or generic
  shell, filesystem, updater, or installer interface.
- Every native resource request rechecks the current Relution device
  assignment.
- Treat native bearer tokens and SQLite data as sensitive operational data.

See [SECURITY.md](SECURITY.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reporting and trust
boundary details.

## Contribution guidance

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing code or documentation.
Changes should preserve the Relution authorization boundary, include tests for
behavioral changes, and distinguish portable checks from Windows, container,
and live-service validation.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Development and testing](docs/DEVELOPMENT.md)
- [HTTP API](docs/HTTP_API.md)
- [Native Windows client](docs/NATIVE_WINDOWS_CLIENT.md)
- [Operations](docs/OPERATIONS.md)
- [Relution adapter](docs/RELUTION_ADAPTER.md)
- [Runtime contract](docs/RUNTIME_CONTRACT.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Release status](RELEASE_STATUS.md)
- [Security policy](SECURITY.md)
