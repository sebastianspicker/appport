# Native Windows client

The Appport Windows client is a Tauri application. Its React WebView renders local state and invokes narrow Rust commands. The WebView cannot make network requests.

Rust validates the compile-time HTTPS Relution API endpoint, stores the client session in Windows Credential Manager, and communicates with Relution.

The client does not embed Relution administrative credentials or service secrets and does not expose a writable local service. Authorization, device association, application catalog data, deployment writes, and action history remain authoritative in Relution. Local sign-out deletes the Credential Manager record; personal token revocation remains a user action in Relution.

Release MSI builds use the Windows x64 MSVC target. Alpha.4 compiles either the
`read_only` or `write_qualification` profile, and the embedded writes flag must
match that profile exactly. Release builds require explicit approval of the fixed
qualification tenant and its class. Write qualification also requires explicit
approval of disposable resources and an externally supplied non-secret
qualification plan.

The candidate artifact is tenant-fixed, unsigned, and non-distributable.
`candidateReady` does not establish `pilotQualified`; Windows and live-tenant
gates remain separate. The profiles do not authorize Relution application
uninstall, administrative, production, signing, or publication operations. MSI
uninstall is used only to clean up candidate verification.
