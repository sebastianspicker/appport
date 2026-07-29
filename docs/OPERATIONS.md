# Operations

Operational ownership is split as follows:

| Area | Owner |
| --- | --- |
| Windows MSI build and signing | Appport release process |
| Fixed Relution API endpoint | Relution operator |
| Authentication, authorization, audit, and deployments | Relution operator |
| Managed-device deployment and inventory | Relution operator |

Build the client MSI on Windows with the MSVC toolchain. Supply the approved non-secret qualification-tenant origin, organization UUID, and native application UUID. The alpha.3 build embeds `APPPORT_RELUTION_WRITES_ENABLED=false`. It produces an unsigned MSI that is not suitable for general distribution.

Run `pnpm alpha:evidence -- --msi C:\absolute\path\Appport.msi` on the Windows build host. The evidence command reruns source gates, validates and fingerprints the build inputs, hashes the MSI, checks its compound-file header and signature state, and scans UTF-8 and UTF-16 strings for forbidden credential markers.

Do not infer Relution availability from a client source gate. When later authorized, record read-only managed-tenant connection, catalog, icon, inventory, and background-check evidence. Certificate trust, authentication, destructive authorization, deployment behavior, signing, and production qualification remain external to this candidate.
