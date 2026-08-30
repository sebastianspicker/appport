# Native Windows client

The Appport Windows client is a Tauri application. Its React WebView renders local state and invokes narrow Rust commands. The WebView cannot make network requests.

Rust validates the compile-time HTTPS Relution API endpoint, stores the client session in Windows Credential Manager, and communicates with Relution.

The client does not embed Relution administrative credentials or service secrets and does not expose a writable local service. Authorization, device association, application catalog data, deployment writes, and action history remain authoritative in Relution. Local sign-out deletes the Credential Manager record; personal token revocation remains a user action in Relution.

The catalog exposes only Available and Updates. Rust authorizes supported
released Windows applications through direct user, direct group, and recursive
group `RELEASE` permissions before consulting the matched device inventory.
Applications that are already current are retained only as an internal
classification. Any catalog, permission, membership, assignment, or inventory
uncertainty fails the read instead of returning an unfiltered catalog.

Signed-in users can expand a read-only support panel. It shows Windows build,
manufacturer, model, SMBIOS serial, MDM state, application version, catalog
counts, and confirmed Relution connection fields when the tenant reports them.
Copying is user initiated and grants the WebView clipboard write permission
only. The client cannot read clipboard content.

Bundle generation requires confirmation of the displayed username, device
name, serial, and last MDM IP. Native code writes one bounded ZIP at a time to
the fixed current-user support directory and exposes no arbitrary output path.
The confirmation is bound to the active session generation and consumed once.
The bundle is never uploaded. Optional collector failures become warning codes;
consent, containment, manifest, and archive failures abort generation. The Open
support folder action resolves the same fixed native path and launches the
absolute System32 Explorer executable without a script shell, frontend path, or
URL.

The client supports personal-token sign-in only.

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
