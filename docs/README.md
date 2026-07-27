# Documentation

The README provides the project overview and local quick start. The documents
in this directory define the implementation and operational contracts in more
detail.

| Document | Scope |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Components, trust boundaries, sign-in, device binding, actions, and persistence |
| [Configuration](CONFIGURATION.md) | Broker, Relution, persistence, tuning, and client build variables |
| [Development](DEVELOPMENT.md) | Installation, local processes, focused checks, and platform boundaries |
| [HTTP API](HTTP_API.md) | Browser, health, native-session, catalog, and action routes |
| [Native Windows client](NATIVE_WINDOWS_CLIENT.md) | Tauri runtime, Windows integration, MSI build, and device validation |
| [Operations](OPERATIONS.md) | Broker and client deployment, canaries, revocation, recovery, and troubleshooting |
| [Relution adapter](RELUTION_ADAPTER.md) | Management API operations, decoder rules, permissions, and tenant qualification |
| [Runtime contract](RUNTIME_CONTRACT.md) | Mandatory topology, proxy, secret, session, backup, and rollback rules |
| [Release checklist](RELEASE_CHECKLIST.md) | Promotion gates for a local candidate and restricted pilot |
| [Release status](../RELEASE_STATUS.md) | Dated verification results and unverified release gates |

Version-specific notes are under [`releases/`](releases/).

Repository-wide policies are in [CONTRIBUTING.md](../CONTRIBUTING.md) and
[SECURITY.md](../SECURITY.md).

## Terminology

| Term | Meaning |
| --- | --- |
| Appport broker | The Next.js service that authenticates users, enforces device and application authorization, persists sessions and actions, and calls Relution |
| Appport Windows client | The Tauri application used for the catalog, installed inventory, updates, and action status |
| Relution | The management system that remains authoritative for users, devices, applications, permissions, inventory, and deployments |
| Relution Windows Agent | The existing managed-device component that performs software installation requested through Relution |
| Native session | An eight-hour bearer session created for the Windows client after browser sign-in and device matching |
| EntDMID | An enrollment identifier read from Windows OMADM data and used as the preferred device match |
| WebView2 | The Windows web runtime that renders the React interface inside Tauri |
| WiX | The Windows installer toolset used by Tauri to create the MSI bundle |
