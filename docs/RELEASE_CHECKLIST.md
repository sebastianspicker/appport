# Release checklist

- [ ] Version 0.1.0-alpha.3 matches the root package, Windows-client package, Tauri configuration, Cargo manifest, and WiX version 0.1.0.3.
- [ ] pnpm install --frozen-lockfile succeeds.
- [ ] pnpm verify succeeds.
- [ ] A Windows x64 MSVC MSI was built with approved, non-secret qualification-tenant origin and UUID inputs, with `APPPORT_RELUTION_WRITES_ENABLED=false`.
- [ ] `pnpm alpha:evidence -- --msi C:\\absolute\\path\\Appport.msi` records the MSI SHA-256, source revision/state, configuration fingerprint, and passing embedded-secret scan.
- [ ] The evidence reports `candidateReady=true`, `signed=false`, and `distributable=false`.
- [ ] Managed-device connection, catalog, icon, inventory, and background-check validation are recorded separately when authorized, without deployment or administrative operations.
- [ ] Destructive authorization, signing, and production qualification remain explicitly external and unqualified.
- [ ] Release notes distinguish candidate evidence from external qualification.

The Windows candidate lane requires fixed approved qualification-tenant repository variables. Its MSI is unsigned and has writes disabled. The artifact is candidate evidence only, not a distributable release.
