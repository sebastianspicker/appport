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
Tokens are masked-console-only: never put them in arguments, environment
variables, files, logs, or reports. Do not place administrative credentials,
client secrets, or private keys in a client environment file or build invocation.
