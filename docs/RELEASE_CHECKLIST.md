# Release checklist

- [ ] Version 0.1.0-alpha.4 matches the root package, Windows-client package, Tauri configuration, Cargo manifest, and WiX version 0.1.0.4.
- [ ] pnpm install --frozen-lockfile succeeds.
- [ ] pnpm verify succeeds.
- [ ] Candidate evidence is generated from a clean checkout; a dirty source tree cannot set `candidateReady=true`.
- [ ] One compile-time `APPPORT_QUALIFICATION_PROFILE` was selected: `read_only` or `write_qualification`.
- [ ] `APPPORT_RELUTION_WRITES_ENABLED` exactly matches the selected profile.
- [ ] Normal source and qualification candidate builds set `APPPORT_RELUTION_DIAGNOSTICS=false` exactly. A diagnostic build with `true` is never candidate-ready or distributable.
- [ ] Qualification candidates set `APPPORT_RELUTION_PASSWORD_AUTH_ENABLED=false` and `APPPORT_RELUTION_PASSWORD_AUTH_CONTRACT=none`; the dormant scaffold is not represented as a working login method.
- [ ] Release build input records `APPPORT_QUALIFICATION_TENANT_APPROVED=true` and `APPPORT_RELUTION_TENANT_CLASS=qualification` with the approved, non-secret qualification-tenant origin and UUID inputs.
- [ ] A write-qualification build records `APPPORT_DISPOSABLE_RESOURCES_APPROVED=true` and an externally supplied, non-secret qualification plan.
- [ ] A Windows x64 MSVC MSI was built with the selected profile.
- [ ] CI installs the MSI, runs `Appport.exe --qualification-self-check`, verifies test-namespaced resource cleanup, and uninstalls the MSI.
- [ ] `pnpm alpha:evidence -- --msi C:\\absolute\\path\\Appport.msi --qualification-utility C:\\absolute\\path\\relution-appport-qualification.exe --windows-self-check C:\\absolute\\path\\windows-self-check.json` records the MSI and operator-utility SHA-256 values, source revision/state, configuration fingerprint, installed-runtime result, and passing embedded-secret scan.
- [ ] The evidence and supplemental configuration fingerprint report `diagnosticsEnabled=false`, `passwordAuthEnabled=false`, `passwordAuthContract=none`, `candidateReady=true`, `signed=false`, and `distributable=false`.
- [ ] Client tokens used only the masked sign-in field, qualification tokens used only masked console input, and no token appears in arguments, environment variables, files, logs, or reports.
- [ ] `pilotQualified=true` is recorded only after separately authorized live qualification under the selected profile.
- [ ] The live utility receives the candidate `evidence.json`; live and cleanup reports match its MSI SHA-256, configuration fingerprint, and source revision, and cleanup postdates the write run.
- [ ] All unrun external gates are explicit, including managed-device connection, catalog, icon, inventory, background checks, and write-qualification validation when applicable.
- [ ] Relution application uninstall, administrative, production, signing, and publication operations remain unqualified and outside alpha.4. MSI uninstall is used only to clean up candidate verification.
- [ ] Release notes distinguish candidate evidence from external qualification.

The Windows candidate lane requires fixed approved qualification-tenant build
inputs. Its MSI is unsigned, tenant-fixed, and non-distributable.
`candidateReady` is candidate-build evidence only; it is not `pilotQualified`.

Diagnostic artifacts are local troubleshooting builds only. Their bounded,
redacted response logs can still contain sensitive tenant response data. Do not
distribute diagnostic artifacts or use them as candidate evidence; delete the
logs after diagnosis under the applicable incident-data policy.

Password authentication remains a disabled compatibility scaffold. A later
release may activate it only after the exact Relution exchange and revocation
contract is documented, implemented without password persistence, and qualified
against the deployed tenant version.
