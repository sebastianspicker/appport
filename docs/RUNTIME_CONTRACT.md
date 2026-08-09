# Runtime contract

The supported runtime is a managed Windows device running the Appport MSI.

- The client has a fixed, trusted HTTPS Relution API endpoint.
- The user can provide valid Relution sign-in credentials.
- Windows Credential Manager is available for client session storage.
- Relution remains authoritative for remote writes, but alpha.3 does not submit them.
- The WebView remains network-isolated; Rust owns service communication.

Unsupported assumptions include runtime endpoint selection in a release build, browser-to-Relution networking, a client-held Relution administrative token, and local server deployment from this repository.
