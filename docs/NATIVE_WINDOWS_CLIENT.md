# Native Windows client

The Appport Windows client is a Tauri application. Its React WebView renders local state and invokes narrow Rust commands. The WebView cannot make network requests.

Rust validates the compile-time HTTPS Relution API endpoint, stores the client session in Windows Credential Manager, and communicates with Relution.

The client does not embed Relution administrative credentials or service secrets and does not expose a writable local service. Authorization, device association, application catalog data, deployment writes, and action history remain authoritative in Relution. Local sign-out deletes the Credential Manager record; personal token revocation remains a user action in Relution.

Release MSI builds use the Windows x64 MSVC target. The Windows candidate lane requires approved qualification-tenant build inputs and produces an unsigned artifact with writes disabled. Code signing, certificate trust, and managed-device validation remain separate release-environment work.
