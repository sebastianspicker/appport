# Configuration

Appport has no server runtime configuration in this repository. The supported client build inputs are:

| Variable | Use |
| --- | --- |
| APPPORT_RELUTION_API_BASE_URL | Required. Fixed HTTPS Relution API root URL embedded in the client. |
| APPPORT_RELUTION_ORGANIZATION_UUID | Required. Fixed Relution organization UUID embedded in the client. |
| APPPORT_NATIVE_APP_UUID | Required. Fixed Appport application UUID embedded in the client. |
| APPPORT_RELUTION_WRITES_ENABLED | Optional build assertion. If present, it must be exactly `false`. Alpha.3 always embeds `false`. |
| APPPORT_SOURCE_VERIFICATION | Set to `true` only for non-release source checks without tenant inputs. |

Release builds require the endpoint and both UUID inputs. Endpoint values must be a fixed HTTPS origin with no credentials, path, query string, or fragment. Release builds reject placeholder hosts and nil or repeated-placeholder UUIDs. A build without valid embedded inputs fails closed instead of selecting configuration at runtime. Release builds also reject source-verification mode.

The approved qualification origin and UUIDs are non-secret build inputs. Relution owns authentication, authorization, token, and audit configuration. Do not place personal tokens, administrative credentials, client secrets, or private keys in a client environment file or build invocation.
