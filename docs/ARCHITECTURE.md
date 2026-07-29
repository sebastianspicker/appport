# Architecture

Appport is a standalone Windows client workspace. It contains a Tauri shell, a React WebView, and Rust native code. It does not contain a service implementation.

    React WebView
      -> Tauri commands
      -> Rust HTTPS client
      -> Relution API

The WebView has `connect-src 'none'` and cannot call a remote service directly. Rust validates the fixed HTTPS endpoint, validates the entered Relution username and personal access token, stores the versioned credential through Windows Credential Manager, and performs authenticated requests.

Relution is authoritative for identity, device assignment, application authorization, inventory, action history, and deployment writes. Sign-out deletes only local state and directs the user to revoke the personal token in Relution. A per-user SQLite journal records action reservations, recovery state, and correlation data without storing the token. The journal exposes no listener or service.

Native metadata and icon caches are scoped to the current credential generation. A new sign-in or sign-out prevents reuse across credentials. Native icon loading permits at most four concurrent requests.

## Build boundary

`APPPORT_RELUTION_API_BASE_URL`, `APPPORT_RELUTION_ORGANIZATION_UUID`, and `APPPORT_NATIVE_APP_UUID` are embedded during compilation. Candidate builds require an approved fixed HTTPS qualification-tenant origin and canonical UUIDs. The build always embeds `APPPORT_RELUTION_WRITES_ENABLED=false`.

Source-only checks may set `APPPORT_SOURCE_VERIFICATION=true`. That mode embeds an invalid test origin and is rejected for release builds.
