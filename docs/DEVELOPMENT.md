# Development

## Prerequisites

- Node.js 24.18.x, pinned in `.node-version`
- pnpm 11.6.0, pinned in `package.json`
- Rust stable for the Tauri core
- Windows 11 x64, the Rust MSVC toolchain, and WiX prerequisites for an MSI
  build

Broker, React, and portable Rust checks run on macOS or Linux. Credential
Manager, OMADM and SMBIOS evidence, Task Scheduler, notifications, protocol
activation, and MSI packaging require Windows.

## Install dependencies

```sh
corepack enable
pnpm install --frozen-lockfile
```

The repository is a pnpm workspace containing the broker, shared contracts, and
Windows client. Do not store production credentials in an environment file.

## Run the mock broker

```sh
export AUTH_MODE=mock
export AUTH_SECRET='replace-with-a-long-random-development-value'
export RELUTION_GATEWAY_MODE=mock
pnpm dev
```

The broker listens on `http://localhost:3000`. Set
`RELUTION_GATEWAY_MODE=mock` explicitly so the mock SQLite path is selected.
The mock adapter supplies fixed users, devices, applications, inventory, and
action outcomes.

The root page is a broker landing page. The catalog is not available in a
browser.

## Run the client interface

```sh
pnpm --dir apps/windows-client dev
```

Vite listens on `http://127.0.0.1:1420`. This mode renders the React interface
but cannot execute Tauri commands.

For a native development run on Windows, point the debug client at a fixed
HTTPS broker origin:

```powershell
$env:RELUTION_BROKER_URL = "https://apps.example.edu"
pnpm --dir apps/windows-client tauri dev
```

The native client rejects HTTP, credentials, query strings, fragments, and
non-root URL paths. Testing the complete local handoff therefore requires a
trusted HTTPS reverse proxy or a lab broker with a trusted certificate.

## Repository checks

Run the documented gate with Node 24.18.x:

```sh
pnpm verify
```

The command runs these stages in order:

```sh
pnpm verify:toolchain
pnpm lint
pnpm typecheck
pnpm test
pnpm client:typecheck
pnpm client:test
pnpm client:build
pnpm client:rust:fmt
pnpm client:rust:clippy
pnpm client:rust:test
pnpm client:rust:check
pnpm build
```

Run an individual stage while diagnosing a failure, then run the full source
gate before handing off a release candidate. Documentation links and style are
reviewed separately because this repository does not provide an automated
documentation checker.

## Test organization

- Broker tests use Vitest and are colocated under `src` as `*.test.ts`.
- Client interface tests use Vitest and Testing Library in
  `apps/windows-client/src/App.test.tsx`.
- Rust unit tests are inside their modules under
  `apps/windows-client/src-tauri/src`.

The tests cover authentication configuration, bounded requests, device
matching, native handoff, session ownership, SQLite migrations and action
state, Relution decoding, read retry behavior, client confirmation, sign-out
outcomes, device evidence parsing, scheduled-task XML, and log redaction.

The repository does not define a coverage provider or coverage threshold.

## Build and test outputs

Dependency, build, test, and evidence paths are excluded by
`.gitignore`, including:

- `node_modules/`
- `.next/`
- `dist/`
- `target/`
- `gen/`
- `*.tsbuildinfo`
- `coverage/`
- `test-results/`
- `release-artifacts/`

Regenerate these paths with the documented commands. Do not add them to source
control.

## Platform validation

Portable checks do not validate:

- Windows-target compilation;
- MSI creation, signing, installation, upgrade, rollback, or uninstall;
- Credential Manager isolation;
- enrolled-device evidence;
- scheduled-task and notification behavior;
- live Relution API behavior;
- the production container and reverse proxy.

The Windows checks are listed in
[NATIVE_WINDOWS_CLIENT.md](NATIVE_WINDOWS_CLIENT.md). Release gates are listed
in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
