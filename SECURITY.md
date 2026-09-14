# Security policy

Security fixes target `0.1.0-alpha.4`. This alpha is built for testing with one
Relution organization at a time. It is unsigned and not ready for production or
distribution.

## Report a vulnerability

Use GitHub's Report a vulnerability option if it is available on this repository.
There is currently no published private security email address. If GitHub does not
offer private reporting, arrange a private channel with the maintainer before
sending vulnerability details.

A useful report includes the affected version, steps to reproduce the problem,
its likely impact, and any workaround you found. Keep credentials, tokens, device
identifiers, customer data, and exploit details out of public issues and
discussions.

## How Appport handles sensitive data

Personal tokens are entered in the desktop client's masked field or the
qualification utility's masked console prompt. Windows Credential Manager stores
the user's session. Tokens are never accepted through command arguments,
environment variables, files, or build settings, and must never appear in logs or
reports. The SQLite journal stores action identifiers and recovery state, without
tokens.

The WebView cannot make network requests. Rust sends requests to one HTTPS Relution
origin set at build time. The running application cannot switch origins,
qualification profiles, or deployment permissions.

Appport refuses catalog access or deployment when it cannot establish the user's
permissions and assigned device. Before sending a deployment request, it records a
local reservation to prevent duplicate submissions. It sends the request once and
does not retry it automatically.

Windows state is stored under fixed paths protected for the current user. Path
checks reject symlinks and reparse points. Support ZIPs require the user's
confirmation and exclude credentials, raw Relution responses, inventory, and the
action journal.

Relution manages authentication, permissions, audit retention, device inventory,
and deployments. Appport does not need administrative tokens, service credentials,
or private keys in its source or build artifacts. See
[Architecture](docs/ARCHITECTURE.md) for the request flow and
[Configuration](docs/CONFIGURATION.md) for diagnostic logging.
