# Contributing

Appport contains a Windows desktop client and a separate browser demo. The
[architecture guide](docs/ARCHITECTURE.md) explains where the main features live
and how the React interface talks to native Rust.

## Get started

Use Node.js 26.5.x, pnpm 11.6.0, and Rust 1.96.0. Install dependencies from the
repository root:

```sh
pnpm install --frozen-lockfile
```

For local previews, Windows setup, and individual test commands, see
[Development](docs/DEVELOPMENT.md).

## Prepare a pull request

Describe the problem your change solves and how you checked it. Include screenshots
for visible interface changes, and update the relevant guide when behavior,
commands, configuration, or build requirements change.

Run the source checks before submitting:

```sh
pnpm verify:source
```

Also run `pnpm demo:verify` if you changed the browser demo, its root package inputs,
or `scripts/verify-demo-artifact.mjs`. The source check does not include the demo.
Mention any checks you could not run. Local tests cannot establish Windows
installation or live Relution behavior.

## Working with the code

React features live beside their tests. Rust unit tests stay with their modules;
integration tests go in `apps/windows-client/src-tauri/tests`.

The React interface imports Tauri only through `src/native-bridge`. When changing
a native command, update its Rust handler, `native-contract.json`, TypeScript
bridge, and contract tests together. Authorization, device matching, deployment,
Windows integration, and persistent state belong in Rust.

The catalog has two views: Available and Updates. Installed applications with no
update are kept out of the public catalog. Keep action outcomes clear, including
failures and unresolved requests. Check keyboard navigation, visible focus,
accessible names and status announcements, narrow layouts, dark mode, and Windows
forced colors when changing the interface.

The browser demo uses fictional data and its own code. Keep it independent of the
desktop runtime, with no sign-in, credentials, saved browser state, or network
client.

For version changes, update the root and Windows-client package manifests, Cargo
manifest and lockfile, Tauri configuration, and WiX version together.

## Testing with Relution

Use local transport mocks for request formats, pagination, retries, permissions,
inventory, icons, and action matching. Test fixtures belong in tests; the product
has no mock mode.

Live testing requires a dedicated qualification tenant and approval from its
operator. Builds that can submit deployments also require approved disposable
resources. Follow [Operations](docs/OPERATIONS.md) for those tests. Never commit
credentials or personal tokens. Signing and distribution are separate release
steps, not part of a normal contribution.
