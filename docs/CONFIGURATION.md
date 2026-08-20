# Configuration

Appport has no server runtime configuration in this repository. The supported client build inputs are:

| Variable | Use |
| --- | --- |
| APPPORT_RELUTION_API_BASE_URL | Required. Fixed HTTPS Relution API root URL embedded in the client. |
| APPPORT_RELUTION_ORGANIZATION_UUID | Required. Fixed Relution organization UUID embedded in the client. |
| APPPORT_NATIVE_APP_UUID | Required. Fixed Appport application UUID embedded in the client. |
| APPPORT_QUALIFICATION_PROFILE | Required for qualification builds. Compile-time value: `read_only` or `write_qualification`. |
| APPPORT_RELUTION_WRITES_ENABLED | Required build assertion. Must exactly match the selected qualification profile. |
| APPPORT_QUALIFICATION_TENANT_APPROVED | Required for release builds. Must be exactly `true`. |
| APPPORT_RELUTION_TENANT_CLASS | Required for release builds. Must be exactly `qualification`. |
| APPPORT_DISPOSABLE_RESOURCES_APPROVED | Required for the `write_qualification` profile. Must be exactly `true`. |
| APPPORT_SOURCE_VERIFICATION | Set to `true` only for non-release source checks without tenant inputs. |
| APPPORT_RELUTION_DIAGNOSTICS | Compile-time opt-in response diagnostics. Set exactly `true` or `false`; source verification defaults to `false`, while qualification builds must set it explicitly. |
| APPPORT_RELUTION_PASSWORD_AUTH_ENABLED | Guarded password-authentication capability. The scaffold accepts only `false`; source verification defaults to `false`, while qualification builds must set it explicitly. |
| APPPORT_RELUTION_PASSWORD_AUTH_CONTRACT | Versioned vendor authentication contract. The scaffold accepts only `none`; source verification defaults to `none`, while qualification builds must set it explicitly. |

`read_only` requires `APPPORT_RELUTION_WRITES_ENABLED=false`.
`write_qualification` requires `APPPORT_RELUTION_WRITES_ENABLED=true`. A build
fails closed if the values do not match. The write profile additionally needs an
externally supplied, non-secret qualification plan; it is not a repository input
and must not be committed or embedded in evidence.

Release builds require the endpoint, both UUID inputs, tenant approval, and
tenant class. Endpoint values must be a fixed HTTPS origin with no credentials,
path, query string, or fragment. Release builds reject placeholder hosts and nil
or repeated-placeholder UUIDs. A build without valid embedded inputs fails
closed instead of selecting configuration at runtime. Release builds also reject
source-verification mode.

The approved qualification origin and UUIDs are non-secret build inputs.
Relution owns authentication, authorization, token, and audit configuration.
The client accepts its token through the masked sign-in field, and the
qualification utility uses masked console input. Never put tokens in arguments,
environment variables, files, logs, or reports. Do not place administrative credentials,
client secrets, or private keys in a client environment file or build invocation.

Password authentication is intentionally dormant. The current Relution REST
contract authenticates third-party clients with a personal API token. Appport
does not guess a password endpoint, use Basic authentication, scrape the portal,
or store a password. A future implementation may enable the capability only
when a fixed, vendor-supported exchange returns a scoped, expiring, revocable
API token and the exact contract has passed live qualification.

`APPPORT_RELUTION_DIAGNOSTICS=true` creates a diagnostic artifact: its
configuration fingerprint differs from a normal candidate. It records each
Relution HTTP response's method, API path, status, and sanitized response body
in `%LOCALAPPDATA%\\Relution\\Appport\\relution-debug.log` (with one rotated
`.log.1` file). It never records request data, headers, query values, or
response headers. The response log is capped at 256 KiB per file and each body
at 8 KiB. JSON values that can identify users, devices, applications, packages,
or credentials are redacted; malformed and binary response bodies are omitted.
Use it only for controlled troubleshooting. The active and rotated files expire
at the next diagnostic write after seven days; remove both immediately after collecting the needed evidence
and retain them only under the applicable incident-data policy.
