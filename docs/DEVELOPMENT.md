# Development

## Set up the repository

Appport uses Node.js 26.5.x from `.node-version`, pnpm 11.6.0, and Rust 1.96.0
from `rust-toolchain.toml`. Install JavaScript dependencies from the repository
root:

```sh
pnpm install --frozen-lockfile
```

Generated files appear under `node_modules`, `dist`, `target`, `coverage`,
`release-artifacts`, and Tauri `gen` directories. Edit the corresponding source and
run the build again instead of changing generated output.

## Run the checks

Before finishing a change to the desktop application, shared tooling, architecture,
or documentation, run:

```sh
pnpm verify:source
```

This checks the pinned toolchain, formatting, documentation, architecture, repository
tools, qualification tools, React application, Rust crate, source-file size, and
duplication. It compiles with a non-routable test origin and cannot reach a Relution
tenant. `pnpm verify` is an alias for the same command.

Use the smaller commands while working:

| Area | Commands |
| --- | --- |
| Documentation and architecture | `pnpm docs:verify`, `pnpm architecture:check` |
| Desktop frontend | `pnpm frontend:check`, `pnpm frontend:test`, `pnpm frontend:build` |
| Rust | `pnpm rust:fmt`, `pnpm rust:clippy`, `pnpm rust:test`, `pnpm rust:check` |
| Repository tools | `pnpm tooling:test` |
| Candidate and qualification tools | `pnpm evidence:test`, `pnpm qualification:check` |
| TypeScript, JavaScript, JSON, and CSS formatting | `pnpm format`, `pnpm format:check` |
| Browser demo | `pnpm demo:verify` |

The production source check does not include `apps/web-demo`. Run
`pnpm demo:verify` whenever the demo or one of its shared root inputs changes.
Markdown is checked by `pnpm docs:verify`; Rust formatting is checked by
`pnpm rust:fmt`.

## Keep changes in the owning module

React feature code belongs in `src/catalog`, `src/session`, or `src/support`, with
screen composition in `src/app`. Only `src/native-bridge` may import Tauri APIs.
Small visual concepts and translated text belong in `src/ui` and `src/i18n`.

On the Rust side, place side-effect-free policy in `domain`, workflows in
`application`, external integrations in `infrastructure`, and command serialization
in `interface`. See [Architecture](ARCHITECTURE.md) for the dependency rules.

When a native command changes, update all four parts of its contract:

1. the Rust command handler;
2. `apps/windows-client/native-contract.json`;
3. the TypeScript bridge; and
4. the contract tests.

Keep React tests beside the feature under test and shared setup in `src/test`. Rust
unit tests stay with their modules; integration tests go in
`apps/windows-client/src-tauri/tests`.

## Quality rules

`pnpm quality:source` checks the desktop client, native crate, and repository tools.
`pnpm quality:source:static` runs the same static checks without Clippy.
`pnpm quality:demo` checks the browser demo, and `pnpm quality:check` checks both
code sets.

ESLint, Stylelint, and Clippy must finish without warnings. JavaScript and TypeScript
cyclomatic complexity and Rust cognitive complexity are limited to 10. Active
`.rs`, `.ts`, `.tsx`, `.mjs`, and `.css` files, including tests, are limited to 500
physical lines. Generated files and the archive, `.local`, `.worktrees`, `index`, and
`design-preview` directories are omitted from this count.

The desktop source and demo each allow at most 1% duplicated lines in strict mode,
using a minimum match of 10 lines and 50 tokens. Entries in
`quality-duplication-baseline.json` describe specific reviewed copies, such as
localized text or explicit domain-to-wire models. New entries should identify an
equally specific copy rather than exclude a directory or file pattern.

`pnpm tooling:test` exercises the source-size check, architecture rules,
documentation links, demo isolation, workflow inputs, and command composition.
GitHub Actions runs the desktop and demo checks as separate jobs for pull requests
and pushes to `main`.

## Run the interfaces locally

To work on the desktop React UI without compiling Rust, run:

```sh
pnpm --dir apps/windows-client dev
```

The browser receives no native bridge in this mode, so sign-in, native persistence,
and Relution access are unavailable.

Running the complete Tauri application requires Windows, the MSVC toolchain, and a
dedicated qualification tenant. This PowerShell example starts a read-only build:

```powershell
$env:APPPORT_RELUTION_API_BASE_URL = Read-Host "Qualification tenant HTTPS origin"
$env:APPPORT_RELUTION_ORGANIZATION_UUID = Read-Host "Organization UUID"
$env:APPPORT_NATIVE_APP_UUID = Read-Host "Appport application UUID"
$env:APPPORT_QUALIFICATION_PROFILE = "read_only"
$env:APPPORT_RELUTION_WRITES_ENABLED = "false"
$env:APPPORT_QUALIFICATION_TENANT_APPROVED = "true"
$env:APPPORT_RELUTION_TENANT_CLASS = "qualification"
$env:APPPORT_SOURCE_REVISION = (git rev-parse HEAD)
$env:APPPORT_RELUTION_DIAGNOSTICS = "false"
pnpm --dir apps/windows-client tauri dev
```

Use [the configuration guide](CONFIGURATION.md) before enabling diagnostic logging.
A diagnostic binary has a different configuration fingerprint, and its file and
stderr output may contain tenant troubleshooting data.

Build and preview the public demo with its production content security policy:

```sh
pnpm demo:build
pnpm --dir apps/web-demo exec vite preview --host 127.0.0.1
```

The demo uses its own entry point, fixtures, state, tests, and build. It has no
sign-in form, native bridge, persistence, service worker, or network client. Its
[README](../apps/web-demo/README.md) explains local development and GitHub Pages
deployment.

## Test catalog performance

Transport mocks cover request shape, decoding, pagination, retry behavior,
permissions, inventory, icons, and remote-action correlation. The application tests
also cover catalog caching, shared refreshes, session isolation, bounded concurrency,
deployment preflight, sign-out during writes, and stale results.

An ignored benchmark compares the serial catalog implementation with the production
authorization path:

```sh
APPPORT_SOURCE_VERIFICATION=true cargo test --manifest-path apps/windows-client/src-tauri/Cargo.toml --lib benchmark_catalog_refresh -- --ignored --nocapture
```

It runs with 10, 100, and 1,000 applications, using three warmups and ten measured
repetitions. The benchmark verifies identical ordered rows and request counts, then
writes samples and timing distributions to the temporary
`appport-catalog-performance.json` file. There is no CI timing threshold. These
synthetic measurements do not include Windows device matching, journal I/O, TLS, or
live Relution latency.

## Review the desktop UI

Exercise both Available and Updates, expanded application details, search,
package-source filters, account controls, confirmation dialogs, action status, and
support-bundle consent. Check English and German, keyboard navigation, narrow
windows, dark mode, and Windows forced colors. An install or update reaches success
only after native inventory confirmation. The receipt omits a final version because
the action response does not provide one.

The UI bundles Manrope for display text and Source Sans 3 for body text, with system
fallbacks. Font sources and OFL notices are documented in
`apps/windows-client/src/ui/fonts/README.md`. No font is fetched at runtime.

A browser test with a synthetic native bridge can cover layout, keyboard use, and
frontend state changes. Windows WebView2, Credential Manager, ACLs, scheduled tasks,
notifications, protocol registration, MSI installation, managed-device behavior,
and live Relution calls require Windows or tenant-specific testing as appropriate.
