# Architecture

Appport has two deployable components:

- a Tauri 2 Windows client with a React interface;
- a Next.js broker with SQLite persistence and a Relution management API
  adapter.

Relution remains authoritative for users, groups, devices, release
permissions, application versions, installed inventory, deployment execution,
and Windows client assignment.

## Component boundaries

```text
React WebView
  -> typed Tauri commands
  -> Rust HTTPS client
  -> Next.js broker
  -> Relution management API
  -> Relution Windows Agent
  -> Winget, MSI, or EXE deployment
```

| Component | Responsibility |
| --- | --- |
| React interface | Catalog, filters, confirmation, action state, and sign-out presentation |
| Tauri Rust core | HTTPS, browser handoff, device evidence, credentials, scheduled checks, notifications, and logs |
| Next.js routes | Browser sign-in, native API, request validation, and security headers |
| Authentication layer | Mock development session or OIDC through Better Auth |
| Relution adapter | User, group, device, catalog, permission, inventory, deployment, and action operations |
| SQLite repository | Actions, audit events, handoffs, native sessions, identity bindings, and security events |

Shared request and response types are exported from
`packages/appport-contracts`.

## Trust boundaries

The Windows WebView has `connect-src 'none'`. It cannot call the broker or
Relution. Rust exposes application-specific Tauri commands and does not include
generic shell, filesystem, HTTP, installer, or updater plugins.

The client contains no Relution service token, OIDC client secret, or user OIDC
token. Its production broker origin is embedded at compile time. Production
secrets exist only as read-only files mounted into the broker.

The broker accepts browser-session cookies for the handoff flow and a separate
bearer token for native resource requests. Native routes derive the user and
device from the bearer session. They do not accept a device identifier from the
client.

## Sign-in and native session

1. The Windows client generates a request identifier, verifier, challenge, and
   state value.
2. It binds an ephemeral callback listener on `127.0.0.1`.
3. The browser opens `/native/connect` with the verifier challenge, state, and
   callback port.
4. The broker records a five-minute handoff request and starts browser sign-in.
5. After authentication, the broker redirects a one-time code to the loopback
   callback. The code expires after at most two minutes.
6. The client validates state and exchanges the code and verifier.
7. The broker matches the supplied device evidence against Windows devices
   assigned to the authenticated Relution user.
8. The broker returns a random native bearer token once and stores only its
   SHA-256 hash.

Browser and native sessions expire after eight hours and are not refreshed. A
user can have at most three active native sessions for one device. The token is
stored in Windows Credential Manager.

The first successful exchange pins the OIDC issuer and subject to the resolved
Relution user UUID. A later mismatch fails closed. Initial username lookup and
the portable bearer are restricted-pilot risks defined in
[RUNTIME_CONTRACT.md](RUNTIME_CONTRACT.md).

## Device binding

The Windows client collects:

- EntDMID from enrolled OMADM account registry records;
- SMBIOS UUID and BIOS serial from system firmware;
- the Windows hostname.

The broker normalizes the values and compares them only with Windows devices
assigned to the current Relution user. EntDMID is preferred. SMBIOS UUID is
accepted when it is the Relution device identifier. Serial number plus hostname
is the corroborated fallback. Missing, placeholder, conflicting, or ambiguous
evidence fails closed.

Only an evidence digest and the selected match are persisted. Every catalog,
inventory, icon, action, and action-status request rechecks the current device
assignment. A failed assignment check revokes the native session.

## Catalog and actions

The live adapter returns only released Winget, Windows MSI, and Windows EXE
applications authorized for the user and device. Version UUIDs determine
eligibility. Display labels are not used as identifiers.

Before dispatch, SQLite reserves one active action per device and application
and records the owner, target version, installed version, and idempotency
fingerprint. Relution deployment is sent once outside the transaction.
Mutation requests are not retried automatically.

Relution action responses map independently:

```text
NEW, PENDING, PUSH_SENT        -> queued
DELIVERED, DELIVERY_CONFIRMED  -> sent
NOT_NOW                        -> deferred
EXECUTED                       -> verifying -> succeeded after inventory proof
ERROR                          -> failed
CANCELLED                      -> cancelled
other or ambiguous responses   -> unknown -> succeeded after reconciliation
```

`unknown` means the broker cannot prove whether a dispatched request was
accepted or completed. The action remains locked and must not be submitted
again until an operator reconciles it with Relution and installed inventory.
Only installed inventory containing the target version UUID changes
`verifying` or `unknown` to `succeeded`.

## Persistence

One broker process owns one SQLite database. The repository enables foreign
keys, WAL mode, and a five-second busy timeout. Schema migrations run when the
repository opens.

SQLite stores:

- action reservations and state;
- immutable audit events;
- native handoff requests and one-time authorization codes;
- hashed native sessions;
- OIDC-to-Relution identity bindings;
- hashed security-event identifiers.

Retention cleanup removes only old terminal actions and their audit events.
Reserved, active, and `unknown` actions are retained.

## Health and readiness

`/api/health` reports process availability.

`/api/ready` loads the configured gateway. In live mode it validates local
configuration and repository access without making a Relution request. The
mock adapter reports ready without opening SQLite.

Production topology and recovery requirements are defined in
[RUNTIME_CONTRACT.md](RUNTIME_CONTRACT.md).
