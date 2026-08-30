# Architecture

Appport is a single Windows desktop application for discovering and requesting
Relution-managed software. It is deliberately not a web service and does not
install software itself.

```text
React features
    -> typed native bridge
    -> Tauri command interface
    -> application services
       -> pure catalog/action/device policy
       -> Relution HTTP adapter
       -> Windows and local persistence adapters
```

The WebView's content-security policy sets `connect-src 'none'`. All remote
traffic therefore crosses a typed Tauri command and is performed by native Rust
against one HTTPS Relution origin embedded at build time.

## Frontend boundaries

`src/app` composes the application. `src/catalog`, `src/session`, and
`src/support` own feature state and UI. `src/native-bridge` is the only module
allowed to import Tauri APIs. `src/i18n` and `src/ui` contain bounded shared
concepts, while `src/test` contains test setup and fixtures.

The frontend renders Available and Updates views, action progress, token sign-in,
and the support flow. It does not contain authorization policy, persistence,
Relution endpoints, or direct network code.

## Native boundaries

The native crate uses four direct layers:

- `interface` decodes commands, maps errors, and preserves the serialized
  frontend contract.
- `application` owns credential-generation fencing, catalog authorization and
  caches, icon concurrency, action reservation/reconciliation, and session
  workflows.
- `domain` contains side-effect-free catalog classification, action transition
  policy, opaque update-key generation, and device matching.
- `infrastructure` contains the Relution HTTP/DTO adapter, SQLite action journal,
  local clock/identifier helpers, logging, and Windows integrations.

Dependency direction is `interface -> application -> domain`. Application code
uses concrete infrastructure adapters because there is one Relution backend and
one Windows deployment target; introducing abstract ports would add indirection
without a second implementation. Infrastructure converts external DTOs to domain
values before policy is evaluated.

The Relution adapter is intentionally transport-only. It owns endpoint paths,
headers, bounded response parsing, pagination, and DTO decoding. It does not own
catalog caches, permission orchestration, mutation eligibility, journal
transitions, or Tauri response models.

## Stable external contracts

- Personal access token sign-in is the sole authentication method. The versioned
  credential target is `Relution/Appport/v1` in Windows Credential Manager.
- Relution is authoritative for identity, assigned devices, application release
  permissions, inventory, action history, and deployment requests.
- The Tauri command names and camelCase/snake_case JSON shapes are the frontend's
  runtime API.
- A per-user SQLite journal records action reservations and correlation state;
  it stores no credential and exposes no listener.
- `relution-appport://updates`, the scheduled background check, Windows update
  notifications, the fixed support-bundle directory, candidate evidence schema,
  and qualification plan are operational integration contracts.

## Safety invariants

Catalog visibility is fail-closed. The application matches local managed-device
evidence to exactly one assigned Windows device, intersects supported released
applications with direct or recursive `RELEASE` permission, and then classifies
installed inventory. Installed-current rows remain internal.

Display reads may use a cache scoped to the active credential generation.
Mutations never trust that cache: they re-fetch device, permission, inventory,
and remote actions, reserve a durable local action, and issue one deployment
POST without automatic mutation retry. Ambiguous submission remains locked as
unknown until reconciled. Internal `Reserved` state is serialized as public
`queued` and never escapes as a separate wire state.

Response bodies and icons are streamed with hard size limits. Update notification
keys are deterministic opaque hashes. Windows journal, task, log, credential, and
support paths are rooted in known folders and guarded against redirected or
reparse-point paths.

Support bundles contain only bounded, sanitized diagnostics after explicit
same-generation consent. They exclude credentials, raw Relution responses,
installed inventory, the action journal, and user-selected output paths.

## Build and qualification

The Relution origin, organization UUID, native application UUID, qualification
profile, write flag, and diagnostic flag are compile-time inputs. Source-only
verification uses a non-routable test configuration through `pnpm verify:source`.
Qualification composes the same `CatalogService` and `ActionService` as the
product so its evidence does not exercise a parallel implementation.

The deterministic source gate checks frontend types/tests/build, Rust
format/check/Clippy/tests, architecture rules, documentation, qualification
configuration, and evidence tooling. Windows runtime, MSI, managed-device, and
live-tenant behavior require their separate evidence lanes.
