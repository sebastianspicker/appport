# Relution integration

The Rust application core calls one fixed Relution SaaS origin. Every authenticated request carries the current user's personal token in `X-User-Access-Token` and remains scoped to the embedded organization UUID.

Connection resolves the entered username to one active Relution user and matches exactly one assigned Windows device from EntDMID, SMBIOS UUID, or serial plus hostname evidence. Catalog and mutation paths evaluate the released application, nested permissions, current inventory, and device assignment. Only Winget, Windows MSI, and Windows EXE applications are eligible, and Appport excludes its own embedded application UUID.

Safe reads use bounded pagination and may retry transient failures twice. Deployment submissions are never retried automatically. JSON responses are limited to 10 MiB. Validated PNG, JPEG, and WebP icons are limited to 1 MiB and remain available only through the typed Tauri command.

The local SQLite journal reserves an action before submission and retains crash-recovery and correlation state without storing the token. Relution action history remains authoritative. `EXECUTED` enters inventory verification; only the exact target version can produce `succeeded`.

The separate qualification utility accepts two ordinary-user tokens from masked console input and emits redacted JSON. It performs read-only denial checks. Destructive probes are recorded as `not_run`; the utility has no path that enables writes.

Changes to a request or response shape require source tests and live tenant qualification against the deployed Relution version.
