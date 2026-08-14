# Runtime contract

The supported runtime is a managed Windows device running the Appport MSI.

- The client has a fixed, trusted HTTPS Relution API endpoint.
- The user can provide valid Relution sign-in credentials.
- Windows Credential Manager is available for client session storage.
- Relution remains authoritative for remote writes. Alpha.4 embeds either the
  `read_only` or `write_qualification` profile; writes are available only in the
  approved write-qualification lane.
- The WebView remains network-isolated; Rust owns service communication.

Unsupported assumptions include runtime endpoint or profile selection in a
release build, browser-to-Relution networking, a client-held Relution
administrative token, token inputs outside masked console entry, local server
deployment from this repository, and uninstall or administrative operation by an
alpha.4 candidate.
